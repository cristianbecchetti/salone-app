// Statistiche su appuntamenti, servizi, operatori e clienti in un periodo.
import type { Appuntamento } from '../types';
import { piuGiorni } from './tempo';

/**
 * Esito di un appuntamento ai fini delle statistiche:
 * - fatto: completato, oppure ancora "prenotato" ma con data già passata (non segnato a mano)
 * - futuro: prenotato da oggi in avanti
 */
export type Esito = 'fatto' | 'futuro' | 'assente' | 'annullato';

export const esitoDi = (a: Appuntamento, oggi: string): Esito =>
  a.stato === 'annullato' ? 'annullato' : a.stato === 'assente' ? 'assente' : a.stato === 'completato' || a.data < oggi ? 'fatto' : 'futuro';

export interface Conteggi {
  totale: number;
  fatto: number;
  futuro: number;
  assente: number;
  annullato: number;
}
const vuoti = (): Conteggi => ({ totale: 0, fatto: 0, futuro: 0, assente: 0, annullato: 0 });
const conta = (c: Conteggi, e: Esito) => {
  c.totale++;
  c[e]++;
};

/** Percentuale di non presentati su quelli che si dovevano già svolgere (fatti + assenti). */
export const tassoAssenze = (c: Conteggi) => (c.fatto + c.assente ? c.assente / (c.fatto + c.assente) : 0);
/** Percentuale di annullati sul totale degli appuntamenti fissati. */
export const tassoAnnullati = (c: Conteggi) => (c.totale ? c.annullato / c.totale : 0);

export interface StatServizio {
  serviceId: number;
  nome: string;
  volte: number;
  minuti: number;
}
export interface StatOperatore {
  staffId: number | null;
  appuntamenti: number;
  /** minuti di lavoro (le pose non contano) */
  minuti: number;
}
export interface StatCliente extends Conteggi {
  clientId: number;
  ultimaVisita?: string;
  prossimo?: string;
}
export interface StatMese extends Conteggi {
  mese: string;
}

export interface Statistiche {
  conteggi: Conteggi;
  servizi: StatServizio[];
  operatori: StatOperatore[];
  clienti: StatCliente[];
  mesi: StatMese[];
  /** clienti con almeno un appuntamento non annullato nel periodo */
  clientiAttivi: number;
  /** clienti il cui primo appuntamento in assoluto (non annullato) cade nel periodo */
  clientiNuovi: number;
}

/**
 * Statistiche del periodo [dal, al]. `tutti` = tutti gli appuntamenti (servono per i clienti nuovi,
 * l'ultima visita e il prossimo appuntamento anche fuori dal periodo).
 */
export function calcola(tutti: Appuntamento[], dal: string, al: string, oggi: string): Statistiche {
  const conteggi = vuoti();
  const servizi = new Map<number, StatServizio>();
  const operatori = new Map<number | null, StatOperatore>();
  const clienti = new Map<number, StatCliente>();
  const mesi = new Map<string, StatMese>();
  const primo = new Map<number, string>();

  for (const a of tutti) {
    const e = esitoDi(a, oggi);
    if (e !== 'annullato') {
      const p = primo.get(a.clientId);
      if (!p || a.data < p) primo.set(a.clientId, a.data);
    }
    if (a.data < dal || a.data > al) continue;

    conta(conteggi, e);
    const mese = a.data.slice(0, 7);
    if (!mesi.has(mese)) mesi.set(mese, { mese, ...vuoti() });
    conta(mesi.get(mese)!, e);
    if (!clienti.has(a.clientId)) clienti.set(a.clientId, { clientId: a.clientId, ...vuoti() });
    conta(clienti.get(a.clientId)!, e);

    // servizi e operatori: solo il lavoro svolto o in programma
    if (e !== 'fatto' && e !== 'futuro') continue;
    const visti = new Set<number>();
    for (const f of a.fasi) {
      const s = servizi.get(f.serviceId) ?? { serviceId: f.serviceId, nome: f.servizio, volte: 0, minuti: 0 };
      if (!visti.has(f.serviceId)) s.volte++;
      visti.add(f.serviceId);
      s.minuti += f.durata;
      servizi.set(f.serviceId, s);
    }
    const lavoro = a.fasi.filter((f) => f.tipo === 'lavoro');
    for (const id of new Set(lavoro.map((f) => f.staffId))) {
      const o = operatori.get(id) ?? { staffId: id, appuntamenti: 0, minuti: 0 };
      o.appuntamenti++;
      o.minuti += lavoro.filter((f) => f.staffId === id).reduce((t, f) => t + f.durata, 0);
      operatori.set(id, o);
    }
  }

  // ultima visita e prossimo appuntamento dei clienti del periodo, su tutto lo storico
  for (const a of tutti) {
    const c = clienti.get(a.clientId);
    if (!c) continue;
    const e = esitoDi(a, oggi);
    if (e === 'fatto' && (!c.ultimaVisita || a.data > c.ultimaVisita)) c.ultimaVisita = a.data;
    if (e === 'futuro' && (!c.prossimo || a.data < c.prossimo)) c.prossimo = a.data;
  }

  const lista = [...clienti.values()];
  return {
    conteggi,
    servizi: [...servizi.values()].sort((x, y) => y.volte - x.volte || y.minuti - x.minuti),
    operatori: [...operatori.values()].sort((x, y) => y.minuti - x.minuti),
    clienti: lista,
    mesi: [...mesi.values()].sort((x, y) => x.mese.localeCompare(y.mese)),
    clientiAttivi: lista.filter((c) => c.totale > c.annullato).length,
    clientiNuovi: [...primo.entries()].filter(([, d]) => d >= dal && d <= al).length,
  };
}

export interface DaRichiamare {
  clientId: number;
  ultimaVisita: string;
  visite: number;
}

/** Clienti venuti almeno una volta, senza visite negli ultimi `giorni` e senza appuntamenti in programma. */
export function daRichiamare(tutti: Appuntamento[], oggi: string, giorni: number): DaRichiamare[] {
  const limite = piuGiorni(oggi, -giorni);
  const per = new Map<number, { ultima?: string; visite: number; futuro: boolean }>();
  for (const a of tutti) {
    const e = esitoDi(a, oggi);
    const c = per.get(a.clientId) ?? { visite: 0, futuro: false };
    if (e === 'fatto') {
      c.visite++;
      if (!c.ultima || a.data > c.ultima) c.ultima = a.data;
    }
    if (e === 'futuro') c.futuro = true;
    per.set(a.clientId, c);
  }
  return [...per.entries()]
    .filter(([, c]) => c.ultima && c.ultima < limite && !c.futuro)
    .map(([clientId, c]) => ({ clientId, ultimaVisita: c.ultima!, visite: c.visite }))
    .sort((x, y) => y.ultimaVisita.localeCompare(x.ultimaVisita));
}
