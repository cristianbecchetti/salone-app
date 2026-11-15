import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Impostazioni } from '../types';
import {
  GIORNO,
  avvisoEmail,
  backupDriveDovuto,
  caricaSuDrive,
  codiceScript,
  erroreDriveDaSegnalare,
  giorniDa,
  nomeFileBackup,
  promemoriaDovuto,
  verificaDrive,
} from './backup';

const ADESSO = Date.parse('2026-11-20T10:00:00');
const fa = (giorni: number, ore = 0) => new Date(ADESSO - giorni * GIORNO - ore * 3600_000).toISOString();
const tra = (ore: number) => new Date(ADESSO + ore * 3600_000).toISOString();
const base = { id: 'main', nomeSalone: 'S', messaggio: '', passo: 15, prefisso: '+39', settimana: [] } as Impostazioni;
const drive: Impostazioni = { ...base, backupModo: 'drive', backupOgniGiorni: 1, driveUrl: 'https://script.google.com/macros/s/x/exec', driveChiave: 'k' };

afterEach(() => vi.unstubAllGlobals());

describe('promemoria del backup manuale', () => {
  it('compare se non è mai stato fatto un backup o se è passato il periodo scelto', () => {
    expect(promemoriaDovuto(base, ADESSO)).toBe(true);
    expect(promemoriaDovuto({ ...base, promemoriaBackupGiorni: 7, ultimoBackup: fa(6) }, ADESSO)).toBe(false);
    expect(promemoriaDovuto({ ...base, promemoriaBackupGiorni: 7, ultimoBackup: fa(7) }, ADESSO)).toBe(true);
    expect(promemoriaDovuto({ ...base, promemoriaBackupGiorni: 1, ultimoBackup: fa(1) }, ADESSO)).toBe(true);
  });
  it('si ripresenta dopo il rinvio, e non compare se disattivato o in modalità Drive', () => {
    const scaduto = { ...base, promemoriaBackupGiorni: 7, ultimoBackup: fa(10) };
    expect(promemoriaDovuto({ ...scaduto, promemoriaRinviatoA: tra(1) }, ADESSO)).toBe(false);
    expect(promemoriaDovuto({ ...scaduto, promemoriaRinviatoA: fa(0, 1) }, ADESSO)).toBe(true);
    expect(promemoriaDovuto({ ...scaduto, promemoriaBackupGiorni: 0 }, ADESSO)).toBe(false);
    expect(promemoriaDovuto({ ...scaduto, backupModo: 'drive' }, ADESSO)).toBe(false);
  });
});

describe('backup automatico su Drive', () => {
  it('parte se mai fatto o se è passato l’intervallo, solo se configurato', () => {
    expect(backupDriveDovuto(drive, ADESSO)).toBe(true);
    expect(backupDriveDovuto({ ...drive, driveUltimoBackup: fa(0, 23) }, ADESSO)).toBe(false);
    expect(backupDriveDovuto({ ...drive, driveUltimoBackup: fa(1) }, ADESSO)).toBe(true);
    expect(backupDriveDovuto({ ...drive, backupOgniGiorni: 7, driveUltimoBackup: fa(3) }, ADESSO)).toBe(false);
    expect(backupDriveDovuto({ ...drive, driveUrl: '' }, ADESSO)).toBe(false);
    expect(backupDriveDovuto({ ...drive, backupModo: 'manuale' }, ADESSO)).toBe(false);
  });
  it('dopo un errore aspetta mezz’ora prima di riprovare', () => {
    const errore = { ...drive, driveUltimoBackup: fa(2), driveErrore: 'offline' };
    expect(backupDriveDovuto({ ...errore, driveUltimoTentativo: new Date(ADESSO - 10 * 60_000).toISOString() }, ADESSO)).toBe(false);
    expect(backupDriveDovuto({ ...errore, driveUltimoTentativo: new Date(ADESSO - 40 * 60_000).toISOString() }, ADESSO)).toBe(true);
  });
  it('segnala con un avviso solo i fallimenti reali, da oltre un giorno dopo la scadenza', () => {
    expect(erroreDriveDaSegnalare({ ...drive, driveErrore: 'x', driveUltimoBackup: fa(1, 5) }, ADESSO)).toBe(false);
    expect(erroreDriveDaSegnalare({ ...drive, driveErrore: 'x', driveUltimoBackup: fa(2) }, ADESSO)).toBe(true);
    expect(erroreDriveDaSegnalare({ ...drive, driveErrore: 'x', driveUltimoBackup: fa(2), promemoriaRinviatoA: tra(2) }, ADESSO)).toBe(false);
    expect(erroreDriveDaSegnalare({ ...drive, driveErrore: '', driveUltimoBackup: fa(5) }, ADESSO)).toBe(false);
    // collegamento non ancora configurato: niente finestra (lo segnala la pagina Altro)
    expect(erroreDriveDaSegnalare({ ...drive, driveUrl: '', driveErrore: 'x' }, ADESSO)).toBe(false);
  });
});

describe('utilità', () => {
  it('giorni trascorsi, nome del file e controllo dell’account', () => {
    expect(giorniDa(undefined, ADESSO)).toBeNull();
    expect(giorniDa(fa(3, 2), ADESSO)).toBe(3);
    expect(nomeFileBackup(new Date(2026, 10, 5, 9, 7))).toBe('salone-backup-2026-11-05-0907.json');
    expect(avvisoEmail('Salone@Gmail.com', 'salone@gmail.com')).toBe('');
    expect(avvisoEmail('salone@gmail.com', 'altro@gmail.com')).toMatch(/altro@gmail.com/);
    expect(avvisoEmail('', 'altro@gmail.com')).toBe('');
  });
  it('il codice dello script contiene la chiave ed è sintatticamente valido', () => {
    const codice = codiceScript('abc123');
    expect(codice).toContain("var CHIAVE = 'abc123';");
    // deve compilare come JavaScript (Apps Script)
    expect(() => new Function(codice)).not.toThrow();
  });

  it("resiste all'invio per e-mail o WhatsApp: righe corte, commenti senza apostrofi", () => {
    const righe = codiceScript('0123456789abcdef0123456789abcdef').split('\n');
    for (const r of righe) {
      expect(r.length, r).toBeLessThanOrEqual(60);
      if (r.trim().startsWith('//')) expect(r, r).not.toMatch(/['"`]/);
    }
  });

  it('anche se ogni riga viene spezzata a 60 caratteri resta valido', () => {
    // simulazione di un client e-mail che manda a capo alle parole: con righe ≤ 60 nulla cambia
    const spezza = (r: string) => r.replace(/(.{1,60})(\s+|$)/g, '$1\n').trimEnd();
    const codice = codiceScript('0123456789abcdef0123456789abcdef').split('\n').map(spezza).join('\n');
    expect(() => new Function(codice)).not.toThrow();
  });
});

describe('chiamate allo script Google', () => {
  it('invia testo semplice con chiave e contenuto, e legge la risposta', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, email: 'salone@gmail.com', file: 'b.json' })));
    vi.stubGlobal('fetch', f);
    const r = await caricaSuDrive('https://script.google.com/x/exec ', 'k', 'b.json', '{"a":1}', 30);
    expect(r.file).toBe('b.json');
    const [url, o] = f.mock.calls[0];
    expect(url).toBe('https://script.google.com/x/exec');
    expect(o.headers['Content-Type']).toBe('text/plain;charset=utf-8');
    expect(JSON.parse(o.body)).toEqual({ chiave: 'k', azione: 'backup', nome: 'b.json', contenuto: '{"a":1}', conserva: 30 });
  });
  it('trasforma risposte di errore in messaggi leggibili', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, errore: 'Chiave non valida' }))));
    await expect(verificaDrive('u', 'k')).rejects.toThrow('Chiave non valida');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>accesso negato</html>', { status: 200 })));
    await expect(verificaDrive('u', 'k')).rejects.toThrow(/App web/);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(verificaDrive('u', 'k')).rejects.toThrow(/non raggiungibile/);
  });
});
