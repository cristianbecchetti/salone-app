// Interpretazione dei comandi vocali (frasi guidate in italiano). Funzioni pure: nessun accesso al database.
import type { Cliente, Operatore, Servizio } from '../types';
import { giornoSettimana, iso, piuGiorni } from './tempo';

/** Testo confrontabile: minuscole, senza accenti né punteggiatura (tiene ":" e "/" per ore e date). */
export const pulisci = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9:/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const NUMERI: Record<string, number> = {
  una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11,
  dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18, diciannove: 19,
  venti: 20, ventuno: 21, ventidue: 22, ventitre: 23, venticinque: 25, trenta: 30, trentuno: 31, quaranta: 40,
  quarantacinque: 45, cinquanta: 50,
};
const numero = (p?: string) => (p == null ? NaN : /^\d+$/.test(p) ? Number(p) : (NUMERI[p] ?? NaN));

const GIORNI: Record<string, number> = { domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6 };
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Data detta a voce: oggi, domani, dopodomani, giovedì, il 25, 25 novembre, 25/11. Null se non c'è. */
export function leggiData(testo: string, oggi: string): string | null {
  const t = ` ${pulisci(testo)} `;
  if (/ dopodomani /.test(t)) return piuGiorni(oggi, 2);
  if (/ domani /.test(t)) return piuGiorni(oggi, 1);
  if (/ oggi | stamattina | stasera | stamani /.test(t)) return oggi;
  for (const [nome, g] of Object.entries(GIORNI)) {
    if (new RegExp(` ${nome} `).test(t)) {
      let d = (g - giornoSettimana(oggi) + 7) % 7;
      if (/ prossim[oa] /.test(t) && d === 0) d = 7;
      return piuGiorni(oggi, d);
    }
  }
  const [anno, mese, giorno] = oggi.split('-').map(Number);
  const conMese = new RegExp(` (\\d{1,2}|${Object.keys(NUMERI).join('|')}) (${MESI.join('|')})(?: (\\d{4}))? `).exec(t);
  const barra = / (\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))? /.exec(t);
  let g = NaN;
  let m = NaN;
  let a = NaN;
  if (conMese) {
    g = numero(conMese[1]);
    m = MESI.indexOf(conMese[2]) + 1;
    a = conMese[3] ? Number(conMese[3]) : NaN;
  } else if (barra) {
    g = Number(barra[1]);
    m = Number(barra[2]);
    a = barra[3] ? Number(barra[3].length === 2 ? `20${barra[3]}` : barra[3]) : NaN;
  } else {
    const solo = / (?:il|per il|del|giorno) (\d{1,2}) /.exec(t);
    if (solo) {
      g = Number(solo[1]);
      m = g >= giorno ? mese : mese + 1;
      a = m > 12 ? anno + 1 : anno;
      m = m > 12 ? 1 : m;
    }
  }
  if (!(g >= 1 && g <= 31 && m >= 1 && m <= 12)) return null;
  if (Number.isNaN(a)) a = m < mese || (m === mese && g < giorno) ? anno + 1 : anno;
  const d = new Date(a, m - 1, g);
  return d.getMonth() === m - 1 ? iso(d) : null;
}

/** Ora detta a voce, in minuti: alle 10, alle 10:30, alle 10 e mezza, alle dieci e un quarto, a mezzogiorno. */
export function leggiOra(testo: string): number | null {
  const t = ` ${pulisci(testo)} `;
  if (/ mezzogiorno /.test(t)) return 12 * 60;
  const m = / (?:alle|ore|le|verso le) (\d{1,2}|[a-z]+)(?::(\d{2})| e (mezza|mezzo|un quarto|tre quarti|\d{1,2}|[a-z]+))? /.exec(t);
  if (!m) return null;
  let h = numero(m[1]);
  if (Number.isNaN(h) || h > 23) return null;
  let min = 0;
  if (m[2]) min = Number(m[2]);
  else if (m[3]) {
    const extra: Record<string, number> = { mezza: 30, mezzo: 30, 'un quarto': 15, 'tre quarti': 45 };
    min = extra[m[3]] ?? numero(m[3]);
    if (Number.isNaN(min) || min > 59) min = 0;
  }
  // "alle 3" in un salone vuol dire le 15
  if (h >= 1 && h <= 7) h += 12;
  return h * 60 + min;
}

const togli = (t: string, pezzo: string) => ` ${t} `.replace(` ${pezzo} `, ' ').trim();

/** Servizi nominati nella frase (prima i nomi più lunghi: "taglio donna" prima di "taglio"). */
export function trovaServizi(testo: string, servizi: Servizio[]): { servizi: Servizio[]; resto: string } {
  let resto = pulisci(testo);
  const trovati: Servizio[] = [];
  for (const s of [...servizi].filter((x) => x.attivo).sort((a, b) => b.nome.length - a.nome.length)) {
    const n = pulisci(s.nome);
    if (n && ` ${resto} `.includes(` ${n} `)) {
      trovati.push(s);
      resto = togli(resto, n);
    }
  }
  return { servizi: trovati, resto };
}

export function trovaOperatore(testo: string, operatori: Operatore[]): { operatore?: Operatore; resto: string } {
  const t = pulisci(testo);
  for (const o of [...operatori].filter((x) => x.attivo).sort((a, b) => b.nome.length - a.nome.length)) {
    const n = pulisci(o.nome);
    if (n && ` ${t} `.includes(` ${n} `)) return { operatore: o, resto: togli(togli(t, `con ${n}`), n) };
  }
  return { resto: t };
}

/** Parole dei comandi che non vanno scambiate per nomi di clienti. */
const PAROLE = new Set(
  'telefono numero cellulare scheda colore ricetta formula prossimo prossima ultimo ultima appuntamento appuntamenti agenda prenota primo libero disponibile oggi domani mattina pomeriggio sera'.split(' '),
);

/** Clienti nominati: prima nome e cognome (in qualsiasi ordine), poi solo nome o solo cognome. */
export function trovaClienti(testo: string, clienti: Cliente[]): Cliente[] {
  const t = ` ${pulisci(testo)} `;
  const completi = clienti.filter((c) => {
    const nc = pulisci(`${c.nome} ${c.cognome}`);
    const cn = pulisci(`${c.cognome} ${c.nome}`);
    return nc.includes(' ') && (t.includes(` ${nc} `) || t.includes(` ${cn} `));
  });
  if (completi.length) return completi;
  return clienti.filter((c) =>
    [c.nome, c.cognome].some((p) => {
      const q = pulisci(p);
      return q.length >= 3 && !PAROLE.has(q) && t.includes(` ${q} `);
    }),
  );
}

export interface Contesto {
  oggi: string;
  clienti: Cliente[];
  servizi: Servizio[];
  operatori: Operatore[];
  fasce: { nome: string; da: number; a: number }[];
}

export type Pagina = 'agenda' | 'reminder' | 'colori' | 'clienti' | 'servizi' | 'personale' | 'orari' | 'impostazioni';

export type Comando =
  | { tipo: 'aiuto' }
  | { tipo: 'apri'; pagina: Pagina }
  | { tipo: 'agenda'; data: string; staffId?: number }
  | { tipo: 'telefono' | 'scheda' | 'prossimo' | 'ultimo'; clienti: Cliente[] }
  | { tipo: 'libero'; serviceIds: number[]; staffId?: number; fascia?: { nome: string; da: number; a: number }; dal: string }
  | {
      tipo: 'prenota';
      clienti: Cliente[];
      serviceIds: number[];
      data?: string;
      inizio?: number;
      staffId?: number;
      /** parole non riconosciute come cliente, per proporle nella ricerca */
      nomeSentito?: string;
    }
  | { tipo: 'sconosciuto'; testo: string };

const PAGINE: Record<string, Pagina> = {
  agenda: 'agenda', clienti: 'clienti', rubrica: 'clienti', reminder: 'reminder', promemoria: 'reminder', colori: 'colori',
  servizi: 'servizi', personale: 'personale', operatori: 'personale', orari: 'orari', impostazioni: 'impostazioni', altro: 'impostazioni',
};

/** Dalla frase detta al comando da eseguire. */
export function interpreta(frase: string, ctx: Contesto): Comando {
  const t = pulisci(frase);
  const tt = ` ${t} `;
  if (!t) return { tipo: 'sconosciuto', testo: frase };
  if (/ (aiuto|cosa posso dire|che cosa posso dire|comandi) /.test(tt)) return { tipo: 'aiuto' };

  const apri = /^(?:apri|vai (?:a|alla|al|in|nella|nel)|mostra(?:mi)?|portami (?:a|alla|al|in))(?: la| le| il| i| pagina)? ([a-z]+)/.exec(t);
  if (apri && PAGINE[apri[1]]) return { tipo: 'apri', pagina: PAGINE[apri[1]] };

  const { servizi, resto: senzaServizi } = trovaServizi(t, ctx.servizi);
  const { operatore, resto } = trovaOperatore(senzaServizi, ctx.operatori);
  const clienti = trovaClienti(resto, ctx.clienti);
  const data = leggiData(t, ctx.oggi);
  const serviceIds = servizi.map((s) => s.id!);

  if (/ (prenota|prenotare|fissa|fissare|segna|metti|registra|nuovo appuntamento|aggiungi un appuntamento) /.test(tt)) {
    const nomeSentito = clienti.length
      ? undefined
      : / per ([a-z]+(?: [a-z]+)?)/.exec(resto.replace(/ (oggi|domani|dopodomani|alle|il|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b.*$/, ''))?.[1];
    return { tipo: 'prenota', clienti, serviceIds, data: data ?? undefined, inizio: leggiOra(t) ?? undefined, staffId: operatore?.id, nomeSentito };
  }
  if (/ (primo|prima) (?:.* )?(libero|libera|disponibile|posto|orario) | quando c e posto | disponibilita /.test(tt)) {
    const fascia = ctx.fasce.find((f) => tt.includes(` ${pulisci(f.nome)} `));
    return { tipo: 'libero', serviceIds, staffId: operatore?.id, fascia, dal: data ?? ctx.oggi };
  }
  if (/ (scheda|ricetta|formula) | che colore | colore (?:di|della|del|per) /.test(tt) && !servizi.length) return { tipo: 'scheda', clienti };
  if (/ (telefono|numero|cellulare) /.test(tt)) return { tipo: 'telefono', clienti };
  if (/ (ultimo|ultima|ultima volta|e venuto|e venuta|storico) /.test(tt) && clienti.length) return { tipo: 'ultimo', clienti };
  if (/ (prossimo|prossima|quando viene|quando torna|quando ha) /.test(tt) && clienti.length) return { tipo: 'prossimo', clienti };
  if (/ (appuntament[a-z]*|agenda|chi c e|cosa c e|cosa abbiamo|impegni|chi viene|chi abbiamo) /.test(tt)) {
    if (clienti.length && !data && !operatore) return { tipo: 'prossimo', clienti };
    return { tipo: 'agenda', data: data ?? ctx.oggi, staffId: operatore?.id };
  }
  if (/ (scheda|ricetta|formula|colore) /.test(tt) && clienti.length) return { tipo: 'scheda', clienti };
  return { tipo: 'sconosciuto', testo: frase };
}

/** Esempi mostrati con "aiuto". */
export const ESEMPI = [
  'Appuntamenti di domani',
  'Chi c’è giovedì con Operatore 1',
  'Primo libero per colore base la mattina',
  'Prenota taglio donna per Maria Rossi giovedì alle 10',
  'Telefono di Maria Rossi',
  'Prossimo appuntamento di Laura',
  'Ultima volta di Maria Rossi',
  'Scheda colore di Maria Rossi',
  'Apri clienti',
];
