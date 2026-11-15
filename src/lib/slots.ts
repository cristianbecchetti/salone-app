import type { Appuntamento, Eccezione, Fascia, Operatore, TipoFase } from '../types';
import { giornoSettimana, hm, piuGiorni } from './tempo';

/** Ordina le fasce e scarta quelle vuote o invertite. */
export function normalizza(fasce: Fascia[]): Fascia[] {
  return fasce.filter((f) => f.a > f.da).sort((x, y) => x.da - y.da);
}

export function intersezione(a: Fascia[], b: Fascia[]): Fascia[] {
  const out: Fascia[] = [];
  for (const x of a)
    for (const y of b) {
      const da = Math.max(x.da, y.da);
      const fine = Math.min(x.a, y.a);
      if (fine > da) out.push({ da, a: fine });
    }
  return normalizza(out);
}

/** Orari di apertura del salone in una data: l'eccezione, se c'è, vince sulla settimana tipo. */
export function fasceSalone(data: string, settimana: Fascia[][], eccezioni: Eccezione[]): Fascia[] {
  const e = eccezioni.find((x) => x.data === data);
  return normalizza(e ? e.fasce : (settimana[giornoSettimana(data)] ?? []));
}

/** Primo giorno di apertura successivo a `dopo` (entro 60 giorni), altrimenti il giorno dopo. */
export function prossimaApertura(dopo: string, settimana: Fascia[][], eccezioni: Eccezione[]): string {
  for (let i = 1; i <= 60; i++) {
    const g = piuGiorni(dopo, i);
    if (fasceSalone(g, settimana, eccezioni).length) return g;
  }
  return piuGiorni(dopo, 1);
}

export const assente = (op: Operatore, data: string) =>
  op.assenze.some((a) => a.dal <= data && data <= a.al);

/** Fasce in cui l'operatore è al lavoro in una data (sempre dentro gli orari del salone). */
export function turnoOperatore(op: Operatore, data: string, salone: Fascia[]): Fascia[] {
  if (!op.attivo || assente(op, data)) return [];
  const t = op.turni[giornoSettimana(data)];
  return t == null ? salone : intersezione(t, salone);
}

export interface Impegno {
  staffId: number;
  da: number;
  a: number;
}

/** Intervalli in cui gli operatori sono occupati: solo le fasi di lavoro, la posa li libera. */
export function impegniDa(appuntamenti: Appuntamento[], escludiId?: number): Impegno[] {
  const out: Impegno[] = [];
  for (const a of appuntamenti) {
    if (a.id === escludiId || a.stato === 'annullato' || a.stato === 'assente') continue;
    for (const f of a.fasi)
      if (f.tipo === 'lavoro' && f.staffId != null && f.durata > 0)
        out.push({ staffId: f.staffId, da: f.inizio, a: f.inizio + f.durata });
  }
  return out;
}

const dentro = (fasce: Fascia[], da: number, a: number) => fasce.some((f) => f.da <= da && a <= f.a);
const libero = (impegni: Impegno[], staffId: number, da: number, a: number) =>
  !impegni.some((i) => i.staffId === staffId && i.da < a && da < i.a);

export interface FaseRichiesta {
  tipo: TipoFase;
  durata: number;
  /** skill richiesta per la fase; assente = chiunque */
  competenza?: string;
}
export interface OperatoreSlot {
  id: number;
  turno: Fascia[];
  competenze: string[];
}
export interface Slot {
  inizio: number;
  fine: number;
  /** operatore di ogni fase, nello stesso ordine di `fasi` (null per la posa) */
  staff: (number | null)[];
  haSkill: boolean;
}

/**
 * Slot liberi in un giorno. L'intero appuntamento deve stare in un'unica fascia di apertura;
 * ogni fase di lavoro deve cadere nel turno del suo operatore e non sovrapporsi ai suoi impegni.
 * Propone sia un solo operatore per tutte le fasi (con tutte le skill, o chiunque se
 * `ancheSenzaSkill`), sia squadre in cui ogni fase va a un operatore che ne ha la skill
 * (es. taglio a uno, piega a un altro).
 */
export function trovaSlot(p: {
  fasi: FaseRichiesta[];
  salone: Fascia[];
  operatori: OperatoreSlot[];
  impegni: Impegno[];
  passo: number;
  nonPrimaDi?: number;
  ancheSenzaSkill?: boolean;
}): Slot[] {
  const totale = p.fasi.reduce((s, f) => s + f.durata, 0);
  if (!totale) return [];
  const passo = Math.max(1, p.passo);
  const lavoro = p.fasi.map((f, i) => (f.tipo === 'lavoro' && f.durata > 0 ? i : -1)).filter((i) => i >= 0);
  const sa = (op: OperatoreSlot, i: number) => !p.fasi[i].competenza || op.competenze.includes(p.fasi[i].competenza!);
  const squadrePossibili = lavoro.length > 1 && Math.pow(p.operatori.length, lavoro.length) <= 5000;
  const out: Slot[] = [];
  for (const fascia of p.salone) {
    for (let t = fascia.da; t + totale <= fascia.a; t += passo) {
      if (t < (p.nonPrimaDi ?? 0)) continue;
      const inizi: number[] = [];
      let c = t;
      for (const f of p.fasi) {
        inizi.push(c);
        c += f.durata;
      }
      const puo = (op: OperatoreSlot, i: number) =>
        dentro(op.turno, inizi[i], inizi[i] + p.fasi[i].durata) &&
        libero(p.impegni, op.id, inizi[i], inizi[i] + p.fasi[i].durata);
      const slot = (scelti: number[], haSkill: boolean): Slot => ({
        inizio: t,
        fine: t + totale,
        staff: p.fasi.map((_, i) => scelti[lavoro.indexOf(i)] ?? null),
        haSkill,
      });

      // un solo operatore per tutto
      for (const op of p.operatori) {
        if (!lavoro.every((i) => puo(op, i))) continue;
        const haSkill = lavoro.every((i) => sa(op, i));
        if (haSkill || p.ancheSenzaSkill) out.push(slot(lavoro.map(() => op.id), haSkill));
      }
      // più operatori, ciascuno con la skill della propria fase
      if (squadrePossibili) {
        const candidati = lavoro.map((i) => p.operatori.filter((op) => sa(op, i) && puo(op, i)));
        const giro = (k: number, scelti: number[]) => {
          if (k === lavoro.length) {
            if (new Set(scelti).size > 1) out.push(slot(scelti, true));
            return;
          }
          for (const op of candidati[k]) giro(k + 1, [...scelti, op.id]);
        };
        if (candidati.every((x) => x.length)) giro(0, []);
      }
    }
  }
  return out.sort((x, y) => x.inizio - y.inizio);
}

/** Dopo un cambio di operatore: la posa segue l'operatore della fase di lavoro che la precede. */
export function allineaPose<T extends { tipo: TipoFase; staffId: number | null }>(fasi: T[]): T[] {
  return fasi.map((f, i) => {
    if (f.tipo !== 'posa') return f;
    const vicino = fasi.slice(0, i).reverse().find((x) => x.tipo === 'lavoro') ?? fasi.slice(i).find((x) => x.tipo === 'lavoro');
    return { ...f, staffId: vicino?.staffId ?? null };
  });
}

export interface FaseDaVerificare {
  nome: string;
  tipo: TipoFase;
  inizio: number;
  durata: number;
  staffId: number | null;
  competenza?: string;
}

/**
 * Avvisi (non bloccanti) per un appuntamento composto a mano:
 * fuori orario, operatore non assegnato / assente / fuori turno / occupato / senza skill.
 */
export function verifica(p: {
  data: string;
  fasi: FaseDaVerificare[];
  salone: Fascia[];
  operatori: Operatore[];
  impegni: Impegno[];
}): string[] {
  const avvisi = new Set<string>();
  if (!p.fasi.length) return [];
  const inizio = p.fasi[0].inizio;
  const ultima = p.fasi[p.fasi.length - 1];
  const fine = ultima.inizio + ultima.durata;
  if (!p.salone.length) avvisi.add('Il salone è chiuso in questa data.');
  else if (!dentro(p.salone, inizio, fine))
    avvisi.add(`L'appuntamento (${hm(inizio)}–${hm(fine)}) esce dall'orario di apertura.`);

  for (const f of p.fasi) {
    if (f.tipo !== 'lavoro' || f.durata <= 0) continue;
    const quando = `${f.nome} (${hm(f.inizio)}–${hm(f.inizio + f.durata)})`;
    if (f.staffId == null) {
      avvisi.add(`Nessun operatore assegnato a ${quando}.`);
      continue;
    }
    const op = p.operatori.find((o) => o.id === f.staffId);
    if (!op) {
      avvisi.add(`L'operatore di ${quando} non esiste più.`);
      continue;
    }
    if (f.competenza && !op.competenze.includes(f.competenza)) avvisi.add(`${op.nome} non ha la skill "${f.competenza}".`);
    if (assente(op, p.data)) avvisi.add(`${op.nome} è assente in questa data.`);
    else if (p.salone.length && !dentro(turnoOperatore(op, p.data, p.salone), f.inizio, f.inizio + f.durata))
      avvisi.add(`${op.nome} non è in turno durante ${quando}.`);
    if (!libero(p.impegni, op.id!, f.inizio, f.inizio + f.durata))
      avvisi.add(`${op.nome} è già occupato durante ${quando}.`);
  }
  return [...avvisi];
}
