// Schede colore cartacee: dal testo letto dalla foto (OCR) ricava le ricette, una per data.
// Riconosce date, tonalità con grammi (7/1 30g, 6.34 20, 6N 40 gr), ossigeno (20 vol, 6%) e brand noti.
import type { ComponenteColore } from '../types';
import { correggiCifre } from './rubrica';

export interface SchedaLetta {
  /** AAAA-MM-GG, vuota se sulla carta non c'era una data leggibile */
  data: string;
  brand: string;
  componenti: ComponenteColore[];
  ossigeno: string;
  grammiOssigeno: number;
  note: string;
  /** righe di testo da cui viene la scheda (per il confronto con la carta) */
  righe: string[];
}

const BRAND = [
  'Wella',
  'Koleston',
  "L'Oréal",
  'Loreal',
  'Majirel',
  'Inoa',
  'Dia Richesse',
  'Schwarzkopf',
  'Igora',
  'Goldwell',
  'Alfaparf',
  'Davines',
  'Framesi',
  'Inebrya',
  'Revlon',
  'Matrix',
  'Redken',
  'Kemon',
  'Echosline',
  'Wella Illumina',
  'Joico',
  'Paul Mitchell',
  'Kérastase',
  'Lisap',
  'Selective',
  'Tec Italy',
  'Kaaral',
  'Vitality',
  'Nouvelle',
  'Fanola',
  'Biopoint',
];
const senzaAccenti = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Data scritta come 12/03/24, 12-3-2024, 12.03.24 → 2024-03-12 */
const DATA = /\b(\d{1,2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{2,4})\b/;
function leggiData(riga: string, oggi: string): { data: string; resto: string } | null {
  const m = riga.match(DATA);
  if (!m) return null;
  const g = Number(m[1]);
  const mese = Number(m[2]);
  let anno = Number(m[3]);
  if (anno < 100) anno += anno <= Number(oggi.slice(2, 4)) + 1 ? 2000 : 1900;
  if (g < 1 || g > 31 || mese < 1 || mese > 12 || anno < 1990) return null;
  const data = `${anno}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
  return { data, resto: riga.replace(m[0], ' ') };
}

/** Ossigeno: "ossigeno 20 vol 60g", "ox 6% 50 gr", "20vol" */
function leggiOssigeno(riga: string): { ossigeno: string; grammi: number; resto: string } | null {
  const vol = riga.match(/(\d{1,2})\s*vol(?:umi)?\b\.?/i);
  const perc = riga.match(/(\d{1,2}(?:[.,]\d)?)\s*%/);
  const parola = /\b(ossigeno|ossig|oss|ox|oxy|attivatore|sviluppo)\b\.?/i.test(riga);
  if (!vol && !perc) return null;
  const tolto = vol ?? perc!;
  let resto = riga.replace(tolto[0], ' ');
  const ossigeno = vol ? `${vol[1]} vol` : `${perc![1].replace('.', ',')}%`;
  // grammi: subito dopo i volumi ("20 vol 75"), oppure ovunque con la "g", oppure (con la parola "ossigeno") un numero qualsiasi
  const dopo = riga.slice(tolto.index! + tolto[0].length).match(/^\s*[-:x]?\s*(\d{2,3})\s*(g|gr|grammi)?\b\.?/i);
  const gr = dopo ?? resto.match(/(\d{1,3})\s*(g|gr|grammi)\b\.?/i) ?? (parola ? resto.match(/\b(\d{2,3})\b/) : null);
  if (gr) resto = resto.replace(gr[0], ' ');
  resto = resto.replace(/\b(ossigeno|ossig|oss|ox|oxy|attivatore|sviluppo)\b\.?/gi, ' ');
  return { ossigeno, grammi: gr ? grammiLetti(gr[1], 200, !!gr[2]) : 0, resto };
}

/**
 * Grammi letti: l'OCR scambia spesso la "g" finale per un 9 ("35g" → "359").
 * Un numero di 3 cifre che finisce per 9 e supera il massimo plausibile perde l'ultima cifra.
 */
export function grammiLetti(testo: string, massimo: number, conG: boolean): number {
  const n = Number(testo);
  if (!conG && testo.length === 3 && testo.endsWith('9') && n > massimo) return Number(testo.slice(0, 2));
  return n;
}

// tonalità: 7/1, 6.34, 10/0, 0/00, 6N, 7GB, 5,5 — seguita (facoltativo) dai grammi
const TONALITA = /\b(\d{1,2}\s*[/.,]\s*\d{1,3}|\d{1,2}[A-Za-z]{1,2})\b(?:\s*[-:=x]?\s*(\d{1,3})\s*(g|gr|grammi)?\b\.?)?/g;

function leggiComponenti(riga: string): { componenti: ComponenteColore[]; resto: string } {
  const componenti: ComponenteColore[] = [];
  let resto = riga;
  for (const m of riga.matchAll(TONALITA)) {
    // si tiene il separatore scritto sulla carta (7/1 Wella, 6.34 L'Oréal); la virgola diventa punto
    const tonalita = m[1].replace(/\s+/g, '').replace(',', '.');
    componenti.push({ tonalita: tonalita.toUpperCase(), grammi: m[2] ? grammiLetti(m[2], 100, !!m[3]) : 0 });
    resto = resto.replace(m[0], ' ');
  }
  return { componenti, resto };
}

function leggiBrand(riga: string): { brand: string; resto: string } | null {
  // tutti i brand e le linee scritti nella riga, nell'ordine (es. "Wella Koleston"); i nomi più lunghi prima
  let r = senzaAccenti(riga);
  let resto = riga;
  const trovati: { nome: string; pos: number }[] = [];
  for (const b of [...BRAND].sort((x, y) => y.length - x.length)) {
    const i = r.indexOf(senzaAccenti(b));
    if (i < 0) continue;
    trovati.push({ nome: b, pos: i });
    const vuoto = ' '.repeat(b.length);
    r = r.slice(0, i) + vuoto + r.slice(i + b.length);
    resto = resto.slice(0, i) + vuoto + resto.slice(i + b.length);
  }
  if (!trovati.length) return null;
  const nomi = trovati.sort((x, y) => x.pos - y.pos).map((t) => t.nome);
  return { brand: [...new Set(nomi)].join(' '), resto };
}

const pulisci = (s: string) =>
  s
    .replace(/\b(colore|ricetta|tinta|tono|toni|g|gr|grammi|\+)\b/gi, ' ')
    .replace(/[|_=•*·:;+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Divide il testo della scheda cartacea in ricette: ogni data comincia una scheda nuova.
 * Le righe prima della prima data che non sono ricette sono l'intestazione (di solito il nome della cliente).
 */
export function leggiSchede(testo: string, oggi: string): { intestazione: string[]; schede: SchedaLetta[] } {
  const intestazione: string[] = [];
  const schede: SchedaLetta[] = [];
  let corrente: SchedaLetta | null = null;
  let brandPrecedente = '';
  const nuova = (data: string): SchedaLetta => ({ data, brand: brandPrecedente, componenti: [], ossigeno: '', grammiOssigeno: 0, note: '', righe: [] });

  for (const grezza of testo.split(/\r?\n/)) {
    const riga = grezza.trim();
    if (!riga) continue;
    let resto = riga;
    const d = leggiData(resto, oggi);
    if (d) {
      corrente = nuova(d.data);
      schede.push(corrente);
      resto = d.resto;
    }
    const b = leggiBrand(resto);
    if (b) resto = b.resto;
    const o = leggiOssigeno(correggiNumeri(resto));
    if (o) resto = o.resto;
    const c = leggiComponenti(correggiNumeri(resto));
    const haRicetta = !!(b || o || c.componenti.length);

    if (!corrente) {
      if (!haRicetta) {
        intestazione.push(riga);
        continue;
      }
      // ricetta senza data: scheda con data da scegliere
      corrente = nuova('');
      schede.push(corrente);
    }
    corrente.righe.push(riga);
    if (b) corrente.brand = brandPrecedente = b.brand;
    if (o) {
      corrente.ossigeno = o.ossigeno;
      corrente.grammiOssigeno = o.grammi;
    }
    corrente.componenti.push(...c.componenti);
    const nota = pulisci(c.resto);
    if (nota.length >= 3 && /\p{L}{3}/u.test(nota)) corrente.note = corrente.note ? `${corrente.note}; ${nota}` : nota;
  }
  return { intestazione, schede: schede.filter((s) => s.componenti.length || s.ossigeno || s.note) };
}

/** Corregge le lettere scambiate per cifre solo vicino ai numeri (7/l → 7/1, 3O g → 30 g). */
const correggiNumeri = (s: string) => s.replace(/\d[\dOolIS|/.,]*/g, (m) => correggiCifre(m));
