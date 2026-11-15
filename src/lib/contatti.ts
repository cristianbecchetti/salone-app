// Telefoni, importazione contatti (rubrica del tablet, vCard, CSV di Google) e messaggi WhatsApp.

export interface Contatto {
  nome: string;
  cognome: string;
  telefono: string;
}

/** Porta un numero in formato internazionale (+39…) togliendo spazi e simboli. */
export function normalizzaTelefono(grezzo: string, prefisso = '+39'): string {
  let t = (grezzo ?? '').trim().replace(/[^\d+]/g, '');
  if (!t) return '';
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (!t.startsWith('+')) t = prefisso + t;
  return '+' + t.slice(1).replace(/\+/g, '');
}

const pulisci = (s: string) => s.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim();

export function parseVCard(testo: string, prefisso = '+39'): Contatto[] {
  // le righe che iniziano con spazio/tab continuano la precedente
  const righe = testo.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: Contatto[] = [];
  let c: { n?: string; fn?: string; tel: { v: string; cell: boolean }[] } | null = null;
  for (const riga of righe) {
    const up = riga.toUpperCase();
    if (up.startsWith('BEGIN:VCARD')) c = { tel: [] };
    else if (up.startsWith('END:VCARD') && c) {
      const tel = (c.tel.find((t) => t.cell) ?? c.tel[0])?.v ?? '';
      let nome = '';
      let cognome = '';
      if (c.n) {
        const p = c.n.split(';').map(pulisci);
        cognome = p[0] ?? '';
        nome = p[1] ?? '';
      }
      if (!nome && !cognome && c.fn) [nome, cognome] = dividiNome(pulisci(c.fn));
      const telefono = normalizzaTelefono(tel, prefisso);
      if ((nome || cognome) && telefono) out.push({ nome, cognome, telefono });
      c = null;
    } else if (c) {
      const i = riga.indexOf(':');
      if (i < 0) continue;
      // "item1.TEL;TYPE=CELL" → chiave TEL
      const intest = riga.slice(0, i).toUpperCase();
      const chiave = intest.split(';')[0].split('.').pop();
      const valore = riga.slice(i + 1);
      if (chiave === 'N') c.n = valore;
      else if (chiave === 'FN') c.fn = valore;
      else if (chiave === 'TEL') c.tel.push({ v: valore, cell: /CELL|MOBILE/.test(intest) });
    }
  }
  return out;
}

export function dividiNome(completo: string): [string, string] {
  const p = completo.trim().split(/\s+/);
  return [p[0] ?? '', p.slice(1).join(' ')];
}

function righeCsv(testo: string): string[][] {
  const righe: string[][] = [];
  let riga: string[] = [];
  let campo = '';
  let virgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const ch = testo[i];
    if (virgolette) {
      if (ch === '"' && testo[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') virgolette = false;
      else campo += ch;
    } else if (ch === '"') virgolette = true;
    else if (ch === ',') {
      riga.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && testo[i + 1] === '\n') i++;
      riga.push(campo);
      campo = '';
      righe.push(riga);
      riga = [];
    } else campo += ch;
  }
  if (campo || riga.length) {
    riga.push(campo);
    righe.push(riga);
  }
  return righe;
}

/** CSV esportato da Google Contatti (formato "Google CSV", vecchio o nuovo). */
export function parseCsvGoogle(testo: string, prefisso = '+39'): Contatto[] {
  const righe = righeCsv(testo.replace(/^﻿/, ''));
  if (righe.length < 2) return [];
  const intest = righe[0].map((x) => x.trim().toLowerCase());
  const col = (...nomi: string[]) => intest.findIndex((x) => nomi.includes(x));
  const iNome = col('first name', 'given name');
  const iCognome = col('last name', 'family name');
  const iCompleto = col('name');
  const iTel = intest.map((x, i) => (/^phone \d+ - value$/.test(x) ? i : -1)).filter((i) => i >= 0);
  const out: Contatto[] = [];
  for (const r of righe.slice(1)) {
    let nome = iNome >= 0 ? (r[iNome] ?? '').trim() : '';
    let cognome = iCognome >= 0 ? (r[iCognome] ?? '').trim() : '';
    if (!nome && !cognome && iCompleto >= 0) [nome, cognome] = dividiNome(r[iCompleto] ?? '');
    const grezzo = iTel.map((i) => r[i] ?? '').find((x) => x.trim()) ?? '';
    const telefono = normalizzaTelefono(grezzo.split(':::')[0], prefisso);
    if ((nome || cognome) && telefono) out.push({ nome, cognome, telefono });
  }
  return out;
}

export function parseFileContatti(nomeFile: string, testo: string, prefisso = '+39'): Contatto[] {
  return /BEGIN:VCARD/i.test(testo) || /\.vcf$/i.test(nomeFile)
    ? parseVCard(testo, prefisso)
    : parseCsvGoogle(testo, prefisso);
}

interface ContactsManager {
  select(props: string[], opts: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>;
}
const rubrica = () => (navigator as Navigator & { contacts?: ContactsManager }).contacts;

/** La rubrica del dispositivo è leggibile solo da Chrome su Android. */
export const rubricaDisponibile = () => !!rubrica()?.select;

export async function scegliDallaRubrica(prefisso = '+39'): Promise<Contatto[]> {
  const scelti = await rubrica()!.select(['name', 'tel'], { multiple: true });
  const out: Contatto[] = [];
  for (const s of scelti) {
    const [nome, cognome] = dividiNome(s.name?.[0] ?? '');
    const telefono = normalizzaTelefono(s.tel?.[0] ?? '', prefisso);
    if ((nome || cognome) && telefono) out.push({ nome, cognome, telefono });
  }
  return out;
}

export function componiMessaggio(modello: string, valori: Record<string, string>): string {
  return modello.replace(/\{(\w+)\}/g, (tutto, chiave: string) => valori[chiave] ?? tutto);
}

/** Apre WhatsApp sulla chat del numero con il testo già scritto (l'invio resta manuale). */
export const linkWhatsApp = (telefono: string, testo = '') =>
  `https://wa.me/${telefono.replace(/\D/g, '')}${testo ? `?text=${encodeURIComponent(testo)}` : ''}`;
