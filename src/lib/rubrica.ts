// Rubrica cartacea: dal testo letto dalla foto (OCR) estrae le coppie nome → telefono
// e le abbina ai clienti in anagrafica che non hanno ancora un numero.
import { normalizzaTelefono } from './contatti';

export interface VoceLetta {
  /** testo della riga (o delle due righe) da cui viene la voce */
  testo: string;
  /** nome come scritto sulla carta, senza il numero */
  nome: string;
  /** numero letto, solo cifre (con + iniziale se c'era) */
  numero: string;
}

/** Errori tipici dell'OCR dentro un numero: O→0, l/I/|→1, S→5, B→8, Z→2 */
export const correggiCifre = (s: string) =>
  s.replace(/[Oo]/g, '0').replace(/[lI|!]/g, '1').replace(/[S]/g, '5').replace(/[B]/g, '8').replace(/[Z]/g, '2');

// sequenza che sembra un telefono: cifre (o lettere scambiate per cifre) con spazi, punti, trattini, barre
// inizia con una cifra vera (o +) e non finisce attaccato a una parola
const TELEFONO = /(?:\+\s*)?\d(?:[\s./\-()]*[\dOolIS|B!Z]){5,15}(?!\p{L})/gu;

/** Trova il numero di telefono in una riga: restituisce il numero e il testo restante. */
export function trovaNumero(riga: string): { numero: string; resto: string } | null {
  let migliore: { numero: string; inizio: number; fine: number } | null = null;
  for (const m of riga.matchAll(TELEFONO)) {
    const grezzo = m[0];
    // almeno 4 cifre vere: evita di prendere parole come "Olio" per un numero
    if ((grezzo.match(/\d/g) ?? []).length < 4) continue;
    const cifre = correggiCifre(grezzo).replace(/[^\d+]/g, '');
    const solo = cifre.replace('+', '');
    if (solo.length < 6 || solo.length > 15) continue;
    if (!migliore || solo.length > migliore.numero.replace('+', '').length)
      migliore = { numero: cifre, inizio: m.index!, fine: m.index! + grezzo.length };
  }
  if (!migliore) return null;
  const resto = (riga.slice(0, migliore.inizio) + ' ' + riga.slice(migliore.fine)).trim();
  return { numero: migliore.numero, resto };
}

/** Pulisce il nome: toglie segni, "tel", "cell", trattini e spazi doppi. */
const pulisciNome = (s: string) =>
  s
    .replace(/\b(tel|tel\.|cell|cell\.|telefono|cellulare|n\.|nr)\b/gi, ' ')
    .replace(/[^\p{L}\s'.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const haNome = (s: string) => (s.match(/\p{L}/gu) ?? []).length >= 3;

/**
 * Estrae le voci dal testo OCR. Una voce è una riga con nome e numero; se una riga ha solo il nome
 * e la successiva solo il numero, le unisce (rubriche scritte su due righe).
 */
export function estraiVoci(testo: string): VoceLetta[] {
  const righe = testo
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);
  const out: VoceLetta[] = [];
  let nomeInAttesa: string | null = null;
  for (const riga of righe) {
    const t = trovaNumero(riga);
    if (!t) {
      nomeInAttesa = haNome(riga) ? riga : null;
      continue;
    }
    const nome = pulisciNome(t.resto);
    if (haNome(nome)) out.push({ testo: riga, nome, numero: t.numero });
    else if (nomeInAttesa) out.push({ testo: `${nomeInAttesa} / ${riga}`, nome: pulisciNome(nomeInAttesa), numero: t.numero });
    nomeInAttesa = null;
  }
  return out;
}

const parole = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/[\s']+/)
    .filter(Boolean);

/** Distanza di modifica (per tollerare una lettera letta male dall'OCR). */
function distanza(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Quanto una parola della carta somiglia a una parola dell'anagrafica: 1 uguale, 0.8 una lettera diversa, 0.4 solo l'iniziale. */
function somiglia(carta: string, anag: string): number {
  if (carta === anag) return 1;
  if (anag.length >= 4 && carta.length >= 4 && distanza(carta, anag) <= 1) return 0.8;
  if (carta.length === 1 && anag.startsWith(carta)) return 0.4;
  return 0;
}

/** Punteggio 0–1 tra il nome letto e un cliente: cognome e nome devono comparire entrambi (in qualunque ordine). */
export function punteggio(nomeLetto: string, c: { nome: string; cognome: string }): number {
  const carta = parole(nomeLetto);
  const cognome = parole(c.cognome);
  const nome = parole(c.nome);
  if (!carta.length || !(cognome.length || nome.length)) return 0;
  const migliore = (p: string) => Math.max(0, ...carta.map((x) => somiglia(x, p)));
  const sc = cognome.length ? Math.min(...cognome.map(migliore)) : 0;
  const sn = nome.length ? Math.min(...nome.map(migliore)) : 0;
  // con un solo nome in anagrafica (es. solo "Maria") basta quello
  if (!cognome.length) return sn * 0.9;
  if (!nome.length) return sc * 0.9;
  if (!sc) return 0;
  return sn ? (sc + sn) / 2 : sc * 0.5;
}

export interface Proposta {
  voce: VoceLetta;
  /** telefono normalizzato con prefisso */
  telefono: string;
  /** cliente proposto (senza telefono), se trovato */
  clientId?: number;
  /** 'sicuro' = nome e cognome corrispondono; 'incerto' = da controllare; 'nessuno' = nessun cliente senza numero */
  esito: 'sicuro' | 'incerto' | 'nessuno';
  /** numero già usato da un altro cliente in anagrafica */
  giaUsatoDa?: number;
}

/**
 * Per ogni voce letta propone il cliente senza telefono più somigliante.
 * Un cliente viene proposto al massimo una volta (alla voce con il punteggio più alto).
 */
export function proponi<C extends { id?: number; nome: string; cognome: string; telefono: string }>(
  voci: VoceLetta[],
  clienti: C[],
  prefisso = '+39',
): Proposta[] {
  const senza = clienti.filter((c) => !c.telefono?.trim());
  const perNumero = new Map(clienti.filter((c) => c.telefono).map((c) => [normalizzaTelefono(c.telefono, prefisso), c.id!]));
  const candidati = voci.map((voce) => {
    let best: { id: number; p: number } | undefined;
    for (const c of senza) {
      const p = punteggio(voce.nome, c);
      if (p > 0 && (!best || p > best.p)) best = { id: c.id!, p };
    }
    return { voce, best };
  });
  // ogni cliente va alla voce che gli somiglia di più
  const preso = new Map<number, number>();
  candidati.forEach((x, i) => {
    if (!x.best) return;
    const j = preso.get(x.best.id);
    if (j == null || candidati[j].best!.p < x.best.p) preso.set(x.best.id, i);
  });
  return candidati.map(({ voce, best }, i) => {
    const telefono = normalizzaTelefono(voce.numero, prefisso);
    const mio = best && preso.get(best.id) === i ? best : undefined;
    return {
      voce,
      telefono,
      clientId: mio?.id,
      esito: !mio ? 'nessuno' : mio.p >= 0.75 ? 'sicuro' : 'incerto',
      giaUsatoDa: perNumero.get(telefono),
    };
  });
}

/** Numero plausibile: prefisso + 8–15 cifre. */
export const numeroPlausibile = (t: string) => /^\+\d{8,15}$/.test(t);
