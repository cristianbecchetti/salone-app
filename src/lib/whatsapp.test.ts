import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Appuntamento, Cliente, Impostazioni } from '../types';
import { corpoTemplate, inviaTemplate, inviaWhatsApp, parametroPulito } from './whatsapp';
import { parametriAppuntamento, parametriMese, parametriPreparazione } from './messaggi';

const base = {
  id: 'main',
  nomeSalone: 'Salone Bea',
  messaggio: '',
  passo: 15,
  prefisso: '+39',
  settimana: [],
} as Impostazioni;
const api: Impostazioni = { ...base, waModo: 'api', waPhoneId: '1234567890', waToken: 'TOKEN', waVersione: 'v23.0', waLingua: 'it' };
const maria: Cliente = { id: 1, nome: 'Maria', cognome: 'Rossi', telefono: '+39 333 1234567', note: '' };
const app = (data: string, inizio: number, servizi: string[]): Appuntamento => ({
  id: 1,
  clientId: 1,
  data,
  inizio,
  fine: inizio + 60,
  stato: 'prenotato',
  note: '',
  fasi: servizi.map((s) => ({ serviceId: 1, servizio: s, nome: s, tipo: 'lavoro', inizio, durata: 60, staffId: 1 })),
});

afterEach(() => vi.unstubAllGlobals());

describe('parametri dei template', () => {
  it('toglie a capo, tabulazioni e spazi multipli, e non lascia parametri vuoti', () => {
    expect(parametroPulito('riga 1\nriga 2\r\n\triga 3')).toBe('riga 1 · riga 2 · riga 3');
    expect(parametroPulito('a      b')).toBe('a   b');
    expect(parametroPulito('   ')).toBe('-');
  });

  it('compila i parametri nell’ordine dei template suggeriti', () => {
    expect(parametriAppuntamento(app('2026-12-05', 600, ['Taglio', 'Piega']), maria, base)).toEqual([
      'Maria',
      'sabato 5 dicembre',
      '10:00',
      'Taglio, Piega',
      'Salone Bea',
    ]);
    expect(parametriMese([app('2026-12-05', 600, ['Colore base']), app('2026-12-19', 900, ['Piega'])], maria, '2026-12', base)).toEqual([
      'Maria',
      'dicembre 2026',
      'Salone Bea',
      'sabato 5 dicembre alle 10:00 (Colore base); sabato 19 dicembre alle 15:00 (Piega)',
    ]);
    expect(parametriPreparazione('2026-12-05', [])).toEqual(['sabato 5 dicembre', 'nessun colore da preparare']);
  });

  it('prepara la richiesta per Meta con il numero senza simboli', () => {
    expect(corpoTemplate('+39 333 1234567', 'conferma_appuntamento', 'it', ['Maria', 'riga\nnuova'])).toEqual({
      messaging_product: 'whatsapp',
      to: '393331234567',
      type: 'template',
      template: {
        name: 'conferma_appuntamento',
        language: { code: 'it' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Maria' },
              { type: 'text', text: 'riga · nuova' },
            ],
          },
        ],
      },
    });
  });
});

describe('invio', () => {
  it('invio diretto: chiama l’API con token e template configurati', async () => {
    const fetchFinto = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchFinto);
    await inviaTemplate({ ...api, waTemplate: { conferma: 'mio_template' } }, 'conferma', maria.telefono, ['Maria']);
    const [url, opzioni] = fetchFinto.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    expect(opzioni.headers.Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(opzioni.body).template.name).toBe('mio_template');
  });

  it('riporta l’errore di Meta in modo leggibile', async () => {
    const errore = { error: { message: 'Template name does not exist', error_data: { details: 'template promemoria_appuntamento non trovato' } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(errore), { status: 404 })));
    await expect(inviaTemplate(api, 'reminder', maria.telefono, ['x'])).rejects.toThrow(
      'WhatsApp ha rifiutato il messaggio: template promemoria_appuntamento non trovato',
    );
  });

  it('senza configurazione non chiama l’API', async () => {
    const fetchFinto = vi.fn();
    vi.stubGlobal('fetch', fetchFinto);
    await expect(inviaTemplate({ ...base, waModo: 'api' }, 'reminder', maria.telefono, [])).rejects.toThrow(/non configurato/);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('modalità app: apre WhatsApp e non chiama l’API', async () => {
    const apri = vi.fn();
    const fetchFinto = vi.fn();
    vi.stubGlobal('window', { open: apri });
    vi.stubGlobal('fetch', fetchFinto);
    const ok = await inviaWhatsApp({ imp: base, tipo: 'reminder', numero: maria.telefono, testo: 'Ciao', parametri: [], a: 'Maria' });
    expect(ok).toBe(true);
    expect(apri).toHaveBeenCalledWith('https://wa.me/393331234567?text=Ciao', '_blank');
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('invio diretto: se l’operatore annulla la conferma non invia nulla', async () => {
    const fetchFinto = vi.fn();
    vi.stubGlobal('confirm', () => false);
    vi.stubGlobal('fetch', fetchFinto);
    const ok = await inviaWhatsApp({ imp: api, tipo: 'reminder', numero: maria.telefono, testo: 'Ciao', parametri: [], a: 'Maria' });
    expect(ok).toBe(false);
    expect(fetchFinto).not.toHaveBeenCalled();
  });
});
