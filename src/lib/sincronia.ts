// Unione dei dati tra dispositivi (tablet, telefono, PC) tramite un file condiviso su Google Drive.
// Ogni record porta `_agg` (ms dell'ultima modifica); le eliminazioni sono registrate in `eliminati`.
// Regola: per ogni record vince la modifica più recente; un'eliminazione vince se è più recente della modifica.
// Funzioni pure: nessun accesso al database.

/** Tabelle sincronizzate e il loro campo chiave. */
export const TABELLE_SYNC = {
  skill: 'id',
  schede: 'id',
  clienti: 'id',
  servizi: 'id',
  operatori: 'id',
  appuntamenti: 'id',
  eccezioni: 'data',
  impostazioni: 'id',
} as const;
export type TabellaSync = keyof typeof TABELLE_SYNC;
export const NOMI_TABELLE = Object.keys(TABELLE_SYNC) as TabellaSync[];

/** Tabelle con chiave numerica automatica: i nuovi record ricevono un id unico tra dispositivi. */
export const TABELLE_AUTO: TabellaSync[] = ['skill', 'schede', 'clienti', 'servizi', 'operatori', 'appuntamenti'];

/** Impostazioni che restano proprie di ogni dispositivo (credenziali, stato dei backup, dimensione testo…). */
export const CAMPI_DISPOSITIVO = [
  'waToken',
  'driveChiave',
  'driveUrl',
  'driveEmail',
  'driveConserva',
  'backupModo',
  'backupOgniGiorni',
  'promemoriaBackupGiorni',
  'promemoriaRinviatoA',
  'ultimoBackup',
  'driveUltimoBackup',
  'driveUltimoTentativo',
  'driveUltimoFile',
  'driveErrore',
  'scalaTesto',
  'syncAttiva',
  'syncUltima',
  'syncErrore',
  'syncSostituisci',
  'syncForzaInvio',
] as const;

export type Record_ = Record<string, unknown> & { _agg?: number };
export interface Istantanea {
  app: 'salone';
  versione: number;
  esportatoIl: string;
  dati: Partial<Record<TabellaSync, Record_[]>>;
  /** 'tabella:chiave' → ms dell'eliminazione */
  eliminati: Record<string, number>;
}

export const istantaneaVuota = (): Istantanea => ({ app: 'salone', versione: 2, esportatoIl: '', dati: {}, eliminati: {} });

export const chiaveDi = (t: TabellaSync, r: Record_) => `${t}:${String(r[TABELLE_SYNC[t]])}`;

/** Id numerico unico tra dispositivi (millisecondi × 1000 + casuale), sotto il limite degli interi sicuri. */
export const nuovoId = (adesso = Date.now(), caso = Math.random()) => adesso * 1000 + Math.floor(caso * 1000);

export function soloCondivise(r: Record_): Record_ {
  const out: Record_ = { ...r };
  for (const c of CAMPI_DISPOSITIVO) delete out[c];
  return out;
}
export function soloDispositivo(r: Record_ | undefined): Record_ {
  const out: Record_ = {};
  if (r) for (const c of CAMPI_DISPOSITIVO) if (c in r && r[c] !== undefined) out[c] = r[c];
  return out;
}

/** Il modo in cui un record viene scritto nel file condiviso (senza i campi del dispositivo). */
export const perCondivisione = (t: TabellaSync, r: Record_) => (t === 'impostazioni' ? soloCondivise(r) : r);

/** JSON con le chiavi in ordine: due record uguali danno sempre lo stesso testo. */
export const canonico = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonico).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v as object)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const uguali = (a: unknown, b: unknown) => canonico(a) === canonico(b);
const agg = (r?: Record_) => (typeof r?._agg === 'number' ? r._agg : 0);

export interface EsitoUnione {
  /** dati uniti (come vanno scritti nel file condiviso) */
  unita: Istantanea;
  /** modifiche da applicare a questo dispositivo */
  daScrivere: { tabella: TabellaSync; record: Record_ }[];
  daEliminare: { tabella: TabellaSync; chiave: unknown }[];
  /** il file condiviso va aggiornato (questo dispositivo ha qualcosa di nuovo) */
  inviare: boolean;
}

/** Unisce i dati di questo dispositivo con quelli del file condiviso. */
export function unisci(locale: Istantanea, remota: Istantanea, adesso = Date.now()): EsitoUnione {
  const eliminati: Record<string, number> = { ...remota.eliminati };
  for (const [k, t] of Object.entries(locale.eliminati)) eliminati[k] = Math.max(t, eliminati[k] ?? 0);

  const unita: Istantanea = { app: 'salone', versione: 2, esportatoIl: new Date(adesso).toISOString(), dati: {}, eliminati };
  const daScrivere: EsitoUnione['daScrivere'] = [];
  const daEliminare: EsitoUnione['daEliminare'] = [];
  let inviare = false;

  for (const t of NOMI_TABELLE) {
    const campo = TABELLE_SYNC[t];
    const L = new Map((locale.dati[t] ?? []).map((r) => [chiaveDi(t, r), r]));
    const R = new Map((remota.dati[t] ?? []).map((r) => [chiaveDi(t, r), r]));
    const risultato: Record_[] = [];
    for (const k of new Set([...L.keys(), ...R.keys()])) {
      const l = L.get(k);
      const r = R.get(k);
      // a parità di data vince il file condiviso, così tutti i dispositivi convergono sugli stessi dati
      const vincitore = !l ? r! : !r ? l : agg(l) > agg(r) ? l : r;
      const eliminatoIl = eliminati[k];
      if (eliminatoIl !== undefined && eliminatoIl >= agg(vincitore)) {
        if (l) daEliminare.push({ tabella: t, chiave: l[campo] });
        if (r) inviare = true;
        continue;
      }
      const condiviso = perCondivisione(t, vincitore);
      risultato.push(condiviso);
      if (!r || !uguali(perCondivisione(t, r), condiviso)) inviare = true;
      const perQui = t === 'impostazioni' ? { ...condiviso, ...soloDispositivo(l) } : vincitore;
      if (!l || !uguali(l, perQui)) daScrivere.push({ tabella: t, record: perQui });
    }
    unita.dati[t] = risultato;
  }
  if (!uguali(Object.keys(eliminati).sort(), Object.keys(remota.eliminati).sort())) inviare = true;
  return { unita, daScrivere, daEliminare, inviare };
}

/**
 * Nuovo dispositivo appena collegato: prende tutto dal file condiviso,
 * tenendo solo le proprie impostazioni di dispositivo.
 */
export function sostituisci(locale: Istantanea, remota: Istantanea): EsitoUnione {
  const daScrivere: EsitoUnione['daScrivere'] = [];
  const daEliminare: EsitoUnione['daEliminare'] = [];
  for (const t of NOMI_TABELLE) {
    const remoti = remota.dati[t] ?? [];
    const chiaviRemote = new Set(remoti.map((r) => chiaveDi(t, r)));
    for (const l of locale.dati[t] ?? []) if (!chiaviRemote.has(chiaveDi(t, l))) daEliminare.push({ tabella: t, chiave: l[TABELLE_SYNC[t]] });
    const impQui = (locale.dati.impostazioni ?? [])[0];
    for (const r of remoti) daScrivere.push({ tabella: t, record: t === 'impostazioni' ? { ...soloCondivise(r), ...soloDispositivo(impQui) } : r });
  }
  return { unita: remota, daScrivere, daEliminare, inviare: false };
}

/**
 * Dopo un ripristino da file: i dati di questo dispositivo diventano quelli di tutti.
 * Ogni record riceve la data di adesso (così vince sugli altri dispositivi) e i record
 * presenti solo nel file condiviso vengono segnati come eliminati.
 */
export function forzaLocale(locale: Istantanea, remota: Istantanea, adesso = Date.now()): EsitoUnione {
  const eliminati: Record<string, number> = { ...remota.eliminati, ...locale.eliminati };
  const unita: Istantanea = { app: 'salone', versione: 2, esportatoIl: new Date(adesso).toISOString(), dati: {}, eliminati };
  const daScrivere: EsitoUnione['daScrivere'] = [];
  for (const t of NOMI_TABELLE) {
    const qui = (locale.dati[t] ?? []).map((r) => ({ ...r, _agg: adesso }));
    const chiaviQui = new Set(qui.map((r) => chiaveDi(t, r)));
    for (const r of remota.dati[t] ?? []) if (!chiaviQui.has(chiaveDi(t, r))) eliminati[chiaveDi(t, r)] = adesso;
    for (const r of qui) {
      delete eliminati[chiaveDi(t, r)];
      daScrivere.push({ tabella: t, record: r });
    }
    unita.dati[t] = qui.map((r) => perCondivisione(t, r));
  }
  return { unita, daScrivere, daEliminare: [], inviare: true };
}

/**
 * Campi davvero cambiati in un aggiornamento (la libreria del database a volte segnala come
 * modificati anche campi rimasti uguali, ad esempio le liste). `_agg` non conta.
 */
export function campiCambiati(modifiche: Record<string, unknown>, prima: Record<string, unknown>): string[] {
  return Object.keys(modifiche).filter((k) => k !== '_agg' && canonico(modifiche[k]) !== canonico(prima?.[k]));
}
