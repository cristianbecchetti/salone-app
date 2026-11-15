import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Appuntamento, Cliente, Eccezione, Fascia, Impostazioni, Operatore, SchedaColore, Servizio, Skill } from './types';

const h = (ore: number) => ore * 60;
const SPEZZATO: Fascia[] = [
  { da: h(9), a: h(13) },
  { da: h(15), a: h(19) },
];

export const IMPOSTAZIONI_BASE: Impostazioni = {
  id: 'main',
  nomeSalone: 'Il mio salone',
  messaggio:
    'Ciao {nome}, ti ricordiamo il tuo appuntamento di {data} alle {ora} da {salone} per: {servizio}. Se non puoi venire avvisaci, grazie!',
  messaggioConferma:
    'Ciao {nome}, confermiamo il tuo appuntamento di {data} alle {ora} da {salone} per: {servizio}. A presto!',
  messaggioMese: 'Ciao {nome}, ecco i tuoi appuntamenti di {mese} da {salone}:',
  numeroMagazzino: '',
  scalaTesto: 1.2,
  reminderFiltro: { verso: 'almeno', minuti: 60 },
  fasceOrarie: [
    { nome: 'Mattina', da: h(9), a: h(13) },
    { nome: 'Pomeriggio', da: h(13), a: h(17) },
    { nome: 'Sera', da: h(17), a: h(21) },
  ],
  backupModo: 'manuale',
  backupOgniGiorni: 1,
  promemoriaBackupGiorni: 7,
  driveConserva: 30,
  waModo: 'app',
  waPhoneId: '',
  waToken: '',
  waVersione: 'v23.0',
  waLingua: 'it',
  waTemplate: {
    reminder: 'promemoria_appuntamento',
    conferma: 'conferma_appuntamento',
    mese: 'riepilogo_mese',
    magazzino: 'preparazione_colori',
  },
  passo: 15,
  prefisso: '+39',
  // domenica e lunedì chiuso, sabato orario continuato
  settimana: [[], [], SPEZZATO, SPEZZATO, SPEZZATO, SPEZZATO, [{ da: h(9), a: h(18) }]],
};

const SERVIZI_BASE: Servizio[] = [
  {
    id: 1,
    nome: 'Taglio donna',
    categoria: 'Taglio',
    attivo: true,
    fasi: [
      { nome: 'Shampoo e taglio', tipo: 'lavoro', durata: 30, variabile: false, competenza: 'Taglio' },
      { nome: 'Piega', tipo: 'lavoro', durata: 30, variabile: true, min: 30, max: 45, competenza: 'Piega' },
    ],
  },
  {
    id: 2,
    nome: 'Taglio uomo',
    categoria: 'Taglio',
    attivo: true,
    fasi: [{ nome: 'Taglio', tipo: 'lavoro', durata: 30, variabile: false, competenza: 'Taglio' }],
  },
  {
    id: 3,
    nome: 'Piega',
    categoria: 'Piega',
    attivo: true,
    fasi: [{ nome: 'Piega', tipo: 'lavoro', durata: 45, variabile: true, min: 30, max: 60, competenza: 'Piega' }],
  },
  {
    id: 4,
    nome: 'Colore base',
    categoria: 'Colore',
    attivo: true,
    preparazione: true,
    fasi: [
      { nome: 'Applicazione tinta', tipo: 'lavoro', durata: 30, variabile: false, competenza: 'Colore' },
      { nome: 'Posa', tipo: 'posa', durata: 30, variabile: false },
      { nome: 'Piega', tipo: 'lavoro', durata: 45, variabile: true, min: 45, max: 60, competenza: 'Piega' },
    ],
  },
  {
    id: 5,
    nome: 'Schiariture',
    categoria: 'Colore',
    attivo: true,
    preparazione: true,
    fasi: [
      { nome: 'Applicazione', tipo: 'lavoro', durata: 60, variabile: true, min: 45, max: 90, competenza: 'Schiariture' },
      { nome: 'Posa', tipo: 'posa', durata: 30, variabile: true, min: 20, max: 45 },
      { nome: 'Tonalizzante e piega', tipo: 'lavoro', durata: 60, variabile: true, min: 45, max: 75, competenza: 'Piega' },
    ],
  },
];

const SEGUE_SALONE = [null, null, null, null, null, null, null];
const OPERATORI_BASE: Operatore[] = [
  { id: 1, nome: 'Operatore 1', colore: '#8e4a7b', competenze: ['Taglio', 'Piega', 'Colore', 'Schiariture'], turni: SEGUE_SALONE, assenze: [], attivo: true },
  { id: 2, nome: 'Operatore 2', colore: '#2f7d8c', competenze: ['Piega'], turni: SEGUE_SALONE, assenze: [], attivo: true },
];

async function skillInUso(servizi: Table<Servizio>, operatori: Table<Operatore>): Promise<string[]> {
  const nomi = new Set<string>();
  for (const s of await servizi.toArray()) for (const f of s.fasi) if (f.competenza) nomi.add(f.competenza);
  for (const o of await operatori.toArray()) for (const k of o.competenze ?? []) nomi.add(k);
  return [...nomi].sort();
}

class SaloneDB extends Dexie {
  skill!: Table<Skill, number>;
  schede!: Table<SchedaColore, number>;
  clienti!: Table<Cliente, number>;
  servizi!: Table<Servizio, number>;
  operatori!: Table<Operatore, number>;
  appuntamenti!: Table<Appuntamento, number>;
  eccezioni!: Table<Eccezione, string>;
  impostazioni!: Table<Impostazioni, string>;

  constructor() {
    super('salone');
    this.version(1).stores({
      clienti: '++id, cognome, nome, telefono',
      servizi: '++id',
      operatori: '++id',
      appuntamenti: '++id, data, clientId',
      eccezioni: 'data',
      impostazioni: 'id',
    });
    // v2: le skill non sono più "servizi che sa fare" ma competenze richieste dalle singole fasi.
    this.version(2).upgrade(async (tx) => {
      const servizi: Servizio[] = await tx.table('servizi').toArray();
      const perServizio = new Map<number, string[]>();
      for (const s of servizi) {
        for (const f of s.fasi)
          if (f.tipo === 'lavoro' && !f.competenza) f.competenza = /piega/i.test(f.nome) ? 'Piega' : s.categoria || s.nome;
        perServizio.set(s.id!, s.fasi.flatMap((f) => (f.competenza ? [f.competenza] : [])));
        await tx.table('servizi').put(s);
      }
      await tx
        .table('operatori')
        .toCollection()
        .modify((o: Operatore & { skill?: number[] }) => {
          o.competenze = [...new Set((o.skill ?? []).flatMap((id) => perServizio.get(id) ?? []))];
          delete o.skill;
        });
      await tx
        .table('appuntamenti')
        .toCollection()
        .modify((a: Appuntamento) => {
          for (const f of a.fasi) {
            const def = servizi.find((s) => s.id === f.serviceId)?.fasi.find((x) => x.nome === f.nome);
            if (def?.competenza) f.competenza = def.competenza;
          }
        });
    });
    // v3: anagrafica delle skill, riempita con quelle già usate da fasi e operatori.
    this.version(3)
      .stores({ skill: '++id, nome' })
      .upgrade(async (tx) => {
        const nomi = await skillInUso(tx.table('servizi'), tx.table('operatori'));
        await tx.table('skill').bulkAdd(nomi.map((nome) => ({ nome })));
      });
    // v4: schede colore dei clienti; i servizi di colore vanno nella pagina Preparazione colori.
    this.version(4)
      .stores({ schede: '++id, clientId, data, appuntamentoId' })
      .upgrade(async (tx) => {
        await tx
          .table('servizi')
          .toCollection()
          .modify((s: Servizio) => {
            s.inviaConferma ??= false;
            s.preparazione ??= /colore|tinta|schiarit|mesh|balayage/i.test(`${s.categoria} ${s.nome}`);
          });
        await tx
          .table('impostazioni')
          .toCollection()
          .modify((i: Impostazioni) => {
            i.messaggioConferma ??= IMPOSTAZIONI_BASE.messaggioConferma;
            i.messaggioMese ??= IMPOSTAZIONI_BASE.messaggioMese;
            i.numeroMagazzino ??= '';
          });
      });
    // Dati di partenza al primo avvio: tutto modificabile dall'app.
    this.on('populate', (tx) => {
      tx.table('skill').bulkAdd(['Taglio', 'Piega', 'Colore', 'Schiariture'].map((nome) => ({ nome })));
      tx.table('impostazioni').add(IMPOSTAZIONI_BASE);
      tx.table('servizi').bulkAdd(SERVIZI_BASE);
      tx.table('operatori').bulkAdd(OPERATORI_BASE);
    });
  }
}

export const db = new SaloneDB();

export function useImpostazioni(): Impostazioni {
  const i = useLiveQuery(() => db.impostazioni.get('main'), []);
  // i campi aggiunti in versioni successive prendono il valore di partenza
  return { ...IMPOSTAZIONI_BASE, ...i };
}

export const TABELLE = ['skill', 'schede', 'clienti', 'servizi', 'operatori', 'appuntamenti', 'eccezioni', 'impostazioni'] as const;

const uguale = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Aggiunge una skill all'anagrafica (se non c'è già) e ne restituisce il nome. */
export async function aggiungiSkill(nome: string): Promise<string | null> {
  const n = nome.trim();
  if (!n) return null;
  const esistente = (await db.skill.toArray()).find((s) => uguale(s.nome, n));
  if (esistente) return esistente.nome;
  await db.skill.add({ nome: n });
  return n;
}

/** Rinomina (nuovo = testo) o elimina (nuovo = null) una skill ovunque sia usata. */
export async function cambiaSkill(id: number, nuovo: string | null): Promise<string | null> {
  const n = nuovo?.trim() || null;
  return db.transaction('rw', db.skill, db.servizi, db.operatori, db.appuntamenti, async () => {
    const s = await db.skill.get(id);
    if (!s) return 'Skill non trovata.';
    if (n === s.nome) return null;
    if (n && (await db.skill.toArray()).some((x) => x.id !== id && uguale(x.nome, n))) return `Esiste già una skill "${n}".`;
    const vecchio = s.nome;
    if (n) await db.skill.update(id, { nome: n });
    else await db.skill.delete(id);
    await db.servizi.toCollection().modify((x) => {
      for (const f of x.fasi) if (f.competenza === vecchio) f.competenza = n ?? undefined;
    });
    await db.operatori.toCollection().modify((o) => {
      o.competenze = o.competenze.flatMap((k) => (k === vecchio ? (n ? [n] : []) : [k]));
    });
    await db.appuntamenti.toCollection().modify((a) => {
      for (const f of a.fasi) if (f.competenza === vecchio) f.competenza = n ?? undefined;
    });
    return null;
  });
}

/** Copia completa dei dati, da salvare come file di backup. */
export async function esportaTutto() {
  const dati: Record<string, unknown[]> = {};
  for (const t of TABELLE) dati[t] = await db.table(t).toArray();
  // token WhatsApp e chiave dello script Drive sono credenziali: non finiscono nei file di backup
  dati.impostazioni = (dati.impostazioni as Impostazioni[]).map(({ waToken: _token, driveChiave: _chiave, ...resto }) => resto);
  return { app: 'salone', versione: 1, esportatoIl: new Date().toISOString(), dati };
}

/** Sostituisce tutti i dati con quelli del backup. */
export async function ripristina(backup: unknown) {
  const b = backup as { app?: string; dati?: Record<string, unknown[]> };
  if (b?.app !== 'salone' || !b.dati) throw new Error('Il file non è un backup di questa app.');
  const dati = b.dati;
  const attuali = await db.impostazioni.get('main');
  const tokenAttuale = attuali?.waToken;
  const chiaveAttuale = attuali?.driveChiave;
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABELLE) {
      await db.table(t).clear();
      if (Array.isArray(dati[t])) await db.table(t).bulkPut(dati[t]);
    }
    // il backup non contiene il token: si tiene quello già presente su questo dispositivo
    if (tokenAttuale) await db.impostazioni.update('main', { waToken: tokenAttuale });
    if (chiaveAttuale) await db.impostazioni.update('main', { driveChiave: chiaveAttuale });
    // backup precedenti all'anagrafica skill: la ricostruisce dai dati
    if (!Array.isArray(dati.skill)) await db.skill.bulkAdd((await skillInUso(db.servizi, db.operatori)).map((nome) => ({ nome })));
  });
}
