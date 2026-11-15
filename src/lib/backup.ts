// Pianificazione del backup (manuale con promemoria, oppure automatico su Google Drive)
// e collegamento allo script Google che salva i file nel Drive del salone.
// Funzioni pure o di rete: nessun accesso diretto al database.
import type { Impostazioni } from '../types';

export const GIORNO = 24 * 60 * 60 * 1000;
/** dopo un tentativo fallito, il prossimo non prima di mezz'ora */
export const ATTESA_DOPO_ERRORE = 30 * 60 * 1000;

const due = (n: number) => String(n).padStart(2, '0');
export const nomeFileBackup = (d = new Date()) =>
  `salone-backup-${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}-${due(d.getHours())}${due(d.getMinutes())}.json`;

const tempo = (iso?: string) => (iso ? Date.parse(iso) : NaN);

/** Giorni interi trascorsi da una data ISO (null se mai). */
export function giorniDa(iso: string | undefined, adesso: number): number | null {
  const t = tempo(iso);
  return Number.isNaN(t) ? null : Math.floor((adesso - t) / GIORNO);
}

export const driveConfigurato = (imp: Impostazioni) => !!imp.driveUrl?.trim() && !!imp.driveChiave?.trim();

/** In modalità Drive: è ora di fare il backup automatico? */
export function backupDriveDovuto(imp: Impostazioni, adesso: number): boolean {
  if (imp.backupModo !== 'drive' || !driveConfigurato(imp)) return false;
  const tentativo = tempo(imp.driveUltimoTentativo);
  if (!Number.isNaN(tentativo) && imp.driveErrore && adesso - tentativo < ATTESA_DOPO_ERRORE) return false;
  const ultimo = tempo(imp.driveUltimoBackup);
  return Number.isNaN(ultimo) || adesso - ultimo >= (imp.backupOgniGiorni ?? 1) * GIORNO;
}

const rinviato = (imp: Impostazioni, adesso: number) => {
  const t = tempo(imp.promemoriaRinviatoA);
  return !Number.isNaN(t) && adesso < t;
};

/** In modalità manuale: va mostrato il promemoria? (0 giorni = promemoria disattivato) */
export function promemoriaDovuto(imp: Impostazioni, adesso: number): boolean {
  if ((imp.backupModo ?? 'manuale') !== 'manuale') return false;
  const ogni = imp.promemoriaBackupGiorni ?? 7;
  if (ogni <= 0 || rinviato(imp, adesso)) return false;
  const ultimo = tempo(imp.ultimoBackup);
  return Number.isNaN(ultimo) || adesso - ultimo >= ogni * GIORNO;
}

/**
 * In modalità Drive: il backup automatico non riesce da più di un giorno oltre la scadenza?
 * (Se il collegamento non è ancora configurato lo dice la pagina Altro, senza finestre a comparsa.)
 */
export function erroreDriveDaSegnalare(imp: Impostazioni, adesso: number): boolean {
  if (imp.backupModo !== 'drive' || rinviato(imp, adesso) || !driveConfigurato(imp)) return false;
  if (!imp.driveErrore) return false;
  const ultimo = tempo(imp.driveUltimoBackup);
  return Number.isNaN(ultimo) || adesso - ultimo >= ((imp.backupOgniGiorni ?? 1) + 1) * GIORNO;
}

export interface RispostaDrive {
  ok: boolean;
  email?: string;
  file?: string;
  errore?: string;
}

/** Chiamata allo script Google (testo semplice: niente richiesta preliminare CORS). */
async function chiamaScript(url: string, corpo: Record<string, unknown>): Promise<RispostaDrive> {
  let r: Response;
  try {
    r = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo),
      redirect: 'follow',
    });
  } catch {
    throw new Error('Google Drive non raggiungibile: controlla la connessione e l’indirizzo dello script.');
  }
  const testo = await r.text();
  let json: RispostaDrive;
  try {
    json = JSON.parse(testo);
  } catch {
    throw new Error(
      r.ok
        ? 'Lo script ha risposto in modo inatteso: controlla che sia pubblicato come "App web" con accesso "Chiunque".'
        : `Google ha risposto con errore ${r.status}.`,
    );
  }
  if (!json.ok) throw new Error(json.errore || 'Lo script ha rifiutato la richiesta.');
  return json;
}

export const verificaDrive = (url: string, chiave: string) => chiamaScript(url, { chiave, azione: 'verifica' });

export const caricaSuDrive = (url: string, chiave: string, nome: string, contenuto: string, conserva: number) =>
  chiamaScript(url, { chiave, azione: 'backup', nome, contenuto, conserva });

/** Avviso se lo script gira con un account diverso da quello indicato nelle impostazioni. */
export function avvisoEmail(attesa: string | undefined, effettiva: string | undefined): string {
  if (!attesa?.trim() || !effettiva) return '';
  return attesa.trim().toLowerCase() === effettiva.toLowerCase()
    ? ''
    : `Attenzione: lo script salva nel Drive di ${effettiva}, non di ${attesa.trim()}.`;
}

/** Codice da incollare su script.google.com (account Google del salone). */
export const codiceScript = (chiave: string) => `// Backup dell'app del salone su Google Drive.
// Incollare su https://script.google.com con l'account Google del salone,
// poi: Esegui il deployment > Nuovo deployment > App web,
//      Esegui come: Me   -   Chi ha accesso: Chiunque.
const CHIAVE = '${chiave}';
const CARTELLA = 'Backup Salone';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.chiave !== CHIAVE) return risposta({ ok: false, errore: 'Chiave non valida' });
    const email = Session.getEffectiveUser().getEmail();
    if (req.azione === 'verifica') return risposta({ ok: true, email: email });
    const cartelle = DriveApp.getFoldersByName(CARTELLA);
    const cartella = cartelle.hasNext() ? cartelle.next() : DriveApp.createFolder(CARTELLA);
    const file = cartella.createFile(req.nome, req.contenuto, 'application/json');
    // tiene solo gli ultimi N backup (gli altri vanno nel cestino di Drive)
    const conserva = Math.max(1, Math.min(365, Number(req.conserva) || 30));
    const elenco = [];
    const it = cartella.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (f.getName().indexOf('salone-backup-') === 0) elenco.push(f);
    }
    elenco.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    elenco.slice(conserva).forEach(function (f) { f.setTrashed(true); });
    return risposta({ ok: true, email: email, file: file.getName() });
  } catch (err) {
    return risposta({ ok: false, errore: String(err) });
  }
}

function risposta(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
