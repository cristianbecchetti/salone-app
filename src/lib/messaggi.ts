// Testi dei messaggi WhatsApp e delle ricette colore. Funzioni pure, senza accesso al database.
import type { Appuntamento, Cliente, Impostazioni, SchedaColore } from '../types';
import { componiMessaggio } from './contatti';
import { aData, dataLunga, hm, minuti } from './tempo';

/** Nomi dei servizi di un appuntamento, senza ripetizioni, nell'ordine di esecuzione. */
export const serviziDi = (a: Appuntamento) => [...new Set(a.fasi.map((f) => f.servizio))].join(', ');

/** 'AAAA-MM' → "dicembre 2026" */
export const nomeMese = (mese: string) =>
  aData(`${mese}-01`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

export function valoriAppuntamento(a: Appuntamento, c: Cliente | undefined, imp: Impostazioni) {
  return {
    nome: c?.nome ?? '',
    data: dataLunga(a.data),
    ora: hm(a.inizio),
    servizio: serviziDi(a),
    salone: imp.nomeSalone,
  };
}

/** Parametri dei template "promemoria" e "conferma": nome, data, ora, servizi, salone. */
export const parametriAppuntamento = (a: Appuntamento, c: Cliente | undefined, imp: Impostazioni) => {
  const v = valoriAppuntamento(a, c, imp);
  return [v.nome, v.data, v.ora, v.servizio, v.salone];
};

export const testoConferma = (a: Appuntamento, c: Cliente | undefined, imp: Impostazioni) =>
  componiMessaggio(imp.messaggioConferma ?? '', valoriAppuntamento(a, c, imp));

/** Appuntamenti ancora validi del cliente nel mese, in ordine di data e ora. */
export function appuntamentiDelMese(tutti: Appuntamento[], clientId: number, mese: string) {
  return tutti
    .filter((a) => a.clientId === clientId && a.data.startsWith(mese) && a.stato !== 'annullato' && a.stato !== 'assente')
    .sort((x, y) => x.data.localeCompare(y.data) || x.inizio - y.inizio);
}

/** Riepilogo di tutti gli appuntamenti del cliente nel mese, con i servizi e la durata. */
export function testoMese(lista: Appuntamento[], c: Cliente | undefined, mese: string, imp: Impostazioni) {
  const intro = componiMessaggio(imp.messaggioMese ?? '', {
    nome: c?.nome ?? '',
    mese: nomeMese(mese),
    salone: imp.nomeSalone,
  });
  const righe = lista.map((a) => {
    const giorno = aData(a.data).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    return `• ${giorno} alle ${hm(a.inizio)}: ${serviziDi(a)} (circa ${minuti(a.fine - a.inizio)})`;
  });
  return [intro, ...righe].join('\n');
}

/** Parametri del template "riepilogo mese": nome, mese, salone, elenco su una riga. */
export function parametriMese(lista: Appuntamento[], c: Cliente | undefined, mese: string, imp: Impostazioni) {
  const elenco = lista
    .map((a) => {
      const giorno = aData(a.data).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
      return `${giorno} alle ${hm(a.inizio)} (${serviziDi(a)})`;
    })
    .join('; ');
  return [c?.nome ?? '', nomeMese(mese), imp.nomeSalone, elenco];
}

/** Una riga leggibile della ricetta: "Wella · 7/1 30 g + 8/0 20 g · ossigeno 20 vol 75 g" */
export function testoRicetta(s: SchedaColore) {
  const comp = s.componenti
    .filter((c) => c.tonalita.trim())
    .map((c) => `${c.tonalita.trim()} ${c.grammi} g`)
    .join(' + ');
  const oss = s.ossigeno.trim() ? `ossigeno ${s.ossigeno.trim()}${s.grammiOssigeno ? ` ${s.grammiOssigeno} g` : ''}` : '';
  return [s.brand.trim(), comp, oss].filter(Boolean).join(' · ');
}

/** Somma dei grammi delle tonalità (senza ossigeno). */
export const grammiTonalita = (s: SchedaColore) => s.componenti.reduce((t, c) => t + (c.grammi || 0), 0);

/** Totale complessivo: tonalità + ossigeno. */
export const grammiTotali = (s: SchedaColore) => grammiTonalita(s) + (s.grammiOssigeno || 0);

/**
 * La ricetta da preparare per un appuntamento: quella registrata per l'appuntamento stesso,
 * altrimenti l'ultima del cliente fatta prima di quella data.
 */
export function ricettaPer(a: Appuntamento, schede: SchedaColore[]): { scheda?: SchedaColore; propria: boolean } {
  const propria = schede.find((s) => s.appuntamentoId === a.id);
  if (propria) return { scheda: propria, propria: true };
  const precedenti = schede
    .filter((s) => s.clientId === a.clientId && s.data <= a.data)
    .sort((x, y) => y.data.localeCompare(x.data) || (y.id ?? 0) - (x.id ?? 0));
  return { scheda: precedenti[0], propria: false };
}

export interface VocePreparazione {
  a: Appuntamento;
  cliente?: Cliente;
  /** minuti dalla mezzanotte in cui serve il colore (inizio della prima fase di colore) */
  ora: number;
  scheda?: SchedaColore;
}

/** Testo della preparazione colori del giorno, da mandare al magazzino. */
export function testoPreparazione(data: string, voci: VocePreparazione[]) {
  const righe = voci.map((v) => {
    const chi = v.cliente ? `${v.cliente.nome} ${v.cliente.cognome}`.trim() : 'Cliente';
    const ricetta = v.scheda ? testoRicetta(v.scheda) || 'scheda vuota' : 'nessuna ricetta registrata';
    const note = v.scheda?.note ? ` (${v.scheda.note})` : '';
    return `• ${hm(v.ora)} ${chi} — ${serviziDi(v.a)}\n  ${ricetta}${note}`;
  });
  return [`Preparazione colori di ${dataLunga(data)}`, ...(righe.length ? righe : ['Nessun colore da preparare.'])].join('\n');
}

/** Parametri del template "preparazione colori": data, elenco su una riga. */
export function parametriPreparazione(data: string, voci: VocePreparazione[]) {
  const elenco = voci
    .map((v) => {
      const chi = v.cliente ? `${v.cliente.nome} ${v.cliente.cognome}`.trim() : 'Cliente';
      const ricetta = v.scheda ? testoRicetta(v.scheda) || 'scheda vuota' : 'nessuna ricetta';
      return `${hm(v.ora)} ${chi}: ${ricetta}`;
    })
    .join('; ');
  return [dataLunga(data), elenco || 'nessun colore da preparare'];
}

/** Filtro per durata dei promemoria: tutti, almeno N minuti, oppure meno di N minuti. */
export interface FiltroDurata {
  verso: 'tutti' | 'almeno' | 'meno';
  minuti: number;
}
export const FILTRO_DURATA_BASE: FiltroDurata = { verso: 'almeno', minuti: 60 };

/** Durata complessiva dell'appuntamento, pose comprese. */
export const durataAppuntamento = (a: Appuntamento) => a.fine - a.inizio;

export function passaFiltroDurata(a: Appuntamento, f: FiltroDurata = FILTRO_DURATA_BASE) {
  if (f.verso === 'tutti') return true;
  const d = durataAppuntamento(a);
  return f.verso === 'almeno' ? d >= f.minuti : d < f.minuti;
}
