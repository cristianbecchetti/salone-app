// Stessi dati su più dispositivi: ogni dispositivo legge e scrive un file condiviso su Google Drive
// (tramite lo script del salone) e unisce i cambiamenti record per record.
import Dexie, { type Transaction } from 'dexie';
import { db } from './db';
import type { Impostazioni } from './types';
import { leggiCondiviso, scriviCondiviso } from './lib/backup';
import {
  CAMPI_DISPOSITIVO,
  NOMI_TABELLE,
  TABELLE_AUTO,
  campiCambiati,
  forzaLocale,
  istantaneaVuota,
  nuovoId,
  sostituisci,
  unisci,
  type EsitoUnione,
  type Istantanea,
  type Record_,
} from './lib/sincronia';

/** dopo una modifica, la si invia agli altri dispositivi entro questo tempo */
const ATTESA_DOPO_MODIFICA = 15 * 1000;
/** controllo periodico dei cambiamenti fatti sugli altri dispositivi */
export const CONTROLLO_OGNI = 2 * 60 * 1000;

const campiDispositivo = new Set<string>(CAMPI_DISPOSITIVO);
const daSync = (t?: Transaction | null) => !!(t as unknown as { __sync?: boolean } | null)?.__sync;
let timer: ReturnType<typeof setTimeout> | undefined;

function segnaModifica() {
  clearTimeout(timer);
  timer = setTimeout(() => void sincronizza(), ATTESA_DOPO_MODIFICA);
}

let registrati = false;
/**
 * Ogni modifica fatta su questo dispositivo riceve la sua data (`_agg`), ogni eliminazione viene annotata
 * e i nuovi record ricevono un id unico tra dispositivi. Le scritture fatte dalla sincronizzazione stessa no.
 */
export function registraHook() {
  if (registrati) return;
  registrati = true;
  for (const t of NOMI_TABELLE) {
    const tabella = db.table(t);
    const auto = TABELLE_AUTO.includes(t);
    tabella.hook('creating', function (chiave, obj: Record_, trans) {
      if (daSync(trans)) return undefined;
      obj._agg = Date.now();
      segnaModifica();
      return auto && (chiave === undefined || chiave === null) ? nuovoId() : undefined;
    });
    tabella.hook('updating', function (modifiche: object, _chiave, prima: object, trans) {
      if (daSync(trans)) return undefined;
      const cambiati = campiCambiati(modifiche as Record<string, unknown>, prima as Record<string, unknown>);
      // nessun valore davvero cambiato, oppure solo impostazioni proprie del dispositivo: non va agli altri
      if (!cambiati.length) return undefined;
      if (t === 'impostazioni' && cambiati.every((k) => campiDispositivo.has(k))) return undefined;
      segnaModifica();
      return { _agg: Date.now() };
    });
    tabella.hook('deleting', function (chiave, _obj, trans) {
      if (daSync(trans)) return;
      const nome = `${t}:${String(chiave)}`;
      trans.on('complete', () => {
        void db.eliminati.put({ chiave: nome, il: Date.now() });
        segnaModifica();
      });
    });
  }
}

async function istantaneaLocale(): Promise<Istantanea> {
  const ist = istantaneaVuota();
  for (const t of NOMI_TABELLE) ist.dati[t] = (await db.table(t).toArray()) as Record_[];
  ist.eliminati = Object.fromEntries((await db.eliminati.toArray()).map((e) => [e.chiave, e.il]));
  return ist;
}

/** Applica a questo dispositivo i cambiamenti arrivati dagli altri (senza rimandarli indietro). */
async function applica(esito: EsitoUnione) {
  if (!esito.daScrivere.length && !esito.daEliminare.length && !Object.keys(esito.unita.eliminati).length) return;
  await db.transaction('rw', [...NOMI_TABELLE.map((t) => db.table(t)), db.eliminati], async () => {
    (Dexie.currentTransaction as unknown as { __sync: boolean }).__sync = true;
    for (const d of esito.daEliminare) await db.table(d.tabella).delete(d.chiave as never);
    for (const s of esito.daScrivere) await db.table(s.tabella).put(s.record);
    await db.eliminati.bulkPut(Object.entries(esito.unita.eliminati).map(([chiave, il]) => ({ chiave, il })));
  });
}

const statoImp = (pezzo: Partial<Impostazioni>) => db.impostazioni.update('main', pezzo);

let inCorso: Promise<void> | null = null;
let ancora = false;

/**
 * Una sincronizzazione completa: legge il file condiviso, unisce, applica qui i cambiamenti
 * degli altri e, se questo dispositivo ha qualcosa di nuovo, riscrive il file.
 * Se un altro dispositivo ha scritto nel frattempo, rilegge e riprova.
 */
export function sincronizza(): Promise<void> {
  if (inCorso) {
    ancora = true;
    return inCorso;
  }
  inCorso = (async () => {
    const imp = await db.impostazioni.get('main');
    if (!imp?.syncAttiva || !imp.driveUrl || !imp.driveChiave) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
      for (let tentativo = 0; tentativo < 4; tentativo++) {
        const letto = await leggiCondiviso(imp.driveUrl, imp.driveChiave);
        const remota: Istantanea = letto.contenuto ? JSON.parse(letto.contenuto) : istantaneaVuota();
        const locale = await istantaneaLocale();
        const esito =
          imp.syncSostituisci && letto.contenuto
            ? sostituisci(locale, remota)
            : imp.syncForzaInvio
              ? forzaLocale(locale, remota)
              : unisci(locale, remota);
        await applica(esito);
        if (!esito.inviare && letto.contenuto) break;
        const scritto = await scriviCondiviso(imp.driveUrl, imp.driveChiave, JSON.stringify(esito.unita), letto.aggiornato);
        if (scritto !== null) break;
        if (tentativo === 3) throw new Error('Il file condiviso cambia continuamente: riprovo più tardi.');
      }
      await statoImp({ syncUltima: new Date().toISOString(), syncErrore: '', syncSostituisci: undefined, syncForzaInvio: undefined });
    } catch (err) {
      await statoImp({ syncErrore: err instanceof Error ? err.message : String(err) });
    }
  })().finally(() => {
    inCorso = null;
    if (ancora) {
      ancora = false;
      setTimeout(() => void sincronizza(), 1000);
    }
  });
  return inCorso;
}

// ---- collegamento di un altro dispositivo con un link ----

interface DatiCollegamento {
  u: string;
  k: string;
  e?: string;
}

const base64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const daBase64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

/** Link da aprire sull'altro dispositivo: contiene indirizzo e chiave dello script (è riservato). */
export function linkCollegamento(imp: Impostazioni, indirizzoApp: string): string {
  const dati: DatiCollegamento = { u: imp.driveUrl ?? '', k: imp.driveChiave ?? '', e: imp.driveEmail };
  return `${indirizzoApp}#collega=${base64url(JSON.stringify(dati))}`;
}

export function leggiCollegamento(hash: string): DatiCollegamento | null {
  const m = /^#collega=([\w-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const d = JSON.parse(daBase64url(m[1])) as DatiCollegamento;
    return d.u && d.k ? d : null;
  } catch {
    return null;
  }
}

/** Collega questo dispositivo: alla prima sincronizzazione prende tutti i dati dal file condiviso. */
export async function collegaDispositivo(d: DatiCollegamento) {
  await statoImp({
    driveUrl: d.u,
    driveChiave: d.k,
    driveEmail: d.e ?? '',
    syncAttiva: true,
    syncSostituisci: true,
    syncErrore: '',
    // i backup su Drive li fa già il dispositivo principale
    backupModo: 'manuale',
    promemoriaBackupGiorni: 0,
  });
  await sincronizza();
}
