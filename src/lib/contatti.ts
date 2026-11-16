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

/** Paesi più frequenti con prefisso internazionale. L'Italia per prima, poi in ordine alfabetico. */
export const PAESI: { iso: string; nome: string; prefisso: string }[] = [
  { iso: 'IT', nome: 'Italia', prefisso: '+39' },
  ...[
    { iso: 'AL', nome: 'Albania', prefisso: '+355' },
    { iso: 'DZ', nome: 'Algeria', prefisso: '+213' },
    { iso: 'SA', nome: 'Arabia Saudita', prefisso: '+966' },
    { iso: 'AR', nome: 'Argentina', prefisso: '+54' },
    { iso: 'AU', nome: 'Australia', prefisso: '+61' },
    { iso: 'AT', nome: 'Austria', prefisso: '+43' },
    { iso: 'BD', nome: 'Bangladesh', prefisso: '+880' },
    { iso: 'BE', nome: 'Belgio', prefisso: '+32' },
    { iso: 'BA', nome: 'Bosnia ed Erzegovina', prefisso: '+387' },
    { iso: 'BR', nome: 'Brasile', prefisso: '+55' },
    { iso: 'BG', nome: 'Bulgaria', prefisso: '+359' },
    { iso: 'CL', nome: 'Cile', prefisso: '+56' },
    { iso: 'CN', nome: 'Cina', prefisso: '+86' },
    { iso: 'CO', nome: 'Colombia', prefisso: '+57' },
    { iso: 'KR', nome: 'Corea del Sud', prefisso: '+82' },
    { iso: 'HR', nome: 'Croazia', prefisso: '+385' },
    { iso: 'DK', nome: 'Danimarca', prefisso: '+45' },
    { iso: 'EC', nome: 'Ecuador', prefisso: '+593' },
    { iso: 'EG', nome: 'Egitto', prefisso: '+20' },
    { iso: 'AE', nome: 'Emirati Arabi Uniti', prefisso: '+971' },
    { iso: 'PH', nome: 'Filippine', prefisso: '+63' },
    { iso: 'FI', nome: 'Finlandia', prefisso: '+358' },
    { iso: 'FR', nome: 'Francia', prefisso: '+33' },
    { iso: 'DE', nome: 'Germania', prefisso: '+49' },
    { iso: 'GH', nome: 'Ghana', prefisso: '+233' },
    { iso: 'JP', nome: 'Giappone', prefisso: '+81' },
    { iso: 'GR', nome: 'Grecia', prefisso: '+30' },
    { iso: 'IN', nome: 'India', prefisso: '+91' },
    { iso: 'IE', nome: 'Irlanda', prefisso: '+353' },
    { iso: 'IL', nome: 'Israele', prefisso: '+972' },
    { iso: 'XK', nome: 'Kosovo', prefisso: '+383' },
    { iso: 'LU', nome: 'Lussemburgo', prefisso: '+352' },
    { iso: 'MK', nome: 'Macedonia del Nord', prefisso: '+389' },
    { iso: 'MT', nome: 'Malta', prefisso: '+356' },
    { iso: 'MA', nome: 'Marocco', prefisso: '+212' },
    { iso: 'MX', nome: 'Messico', prefisso: '+52' },
    { iso: 'MD', nome: 'Moldavia', prefisso: '+373' },
    { iso: 'MC', nome: 'Monaco', prefisso: '+377' },
    { iso: 'ME', nome: 'Montenegro', prefisso: '+382' },
    { iso: 'NG', nome: 'Nigeria', prefisso: '+234' },
    { iso: 'NO', nome: 'Norvegia', prefisso: '+47' },
    { iso: 'NL', nome: 'Paesi Bassi', prefisso: '+31' },
    { iso: 'PK', nome: 'Pakistan', prefisso: '+92' },
    { iso: 'PE', nome: 'Perù', prefisso: '+51' },
    { iso: 'PL', nome: 'Polonia', prefisso: '+48' },
    { iso: 'PT', nome: 'Portogallo', prefisso: '+351' },
    { iso: 'GB', nome: 'Regno Unito', prefisso: '+44' },
    { iso: 'CZ', nome: 'Repubblica Ceca', prefisso: '+420' },
    { iso: 'RO', nome: 'Romania', prefisso: '+40' },
    { iso: 'RU', nome: 'Russia', prefisso: '+7' },
    { iso: 'SM', nome: 'San Marino', prefisso: '+378' },
    { iso: 'SN', nome: 'Senegal', prefisso: '+221' },
    { iso: 'RS', nome: 'Serbia', prefisso: '+381' },
    { iso: 'SK', nome: 'Slovacchia', prefisso: '+421' },
    { iso: 'SI', nome: 'Slovenia', prefisso: '+386' },
    { iso: 'ES', nome: 'Spagna', prefisso: '+34' },
    { iso: 'LK', nome: 'Sri Lanka', prefisso: '+94' },
    { iso: 'US', nome: 'Stati Uniti / Canada', prefisso: '+1' },
    { iso: 'SE', nome: 'Svezia', prefisso: '+46' },
    { iso: 'CH', nome: 'Svizzera', prefisso: '+41' },
    { iso: 'TN', nome: 'Tunisia', prefisso: '+216' },
    { iso: 'TR', nome: 'Turchia', prefisso: '+90' },
    { iso: 'UA', nome: 'Ucraina', prefisso: '+380' },
    { iso: 'HU', nome: 'Ungheria', prefisso: '+36' },
    { iso: 'VA', nome: 'Vaticano', prefisso: '+379' },
    { iso: 'VE', nome: 'Venezuela', prefisso: '+58' },
  ].sort((a, b) => a.nome.localeCompare(b.nome, 'it')),
];

/** Bandiera emoji dal codice ISO del paese (es. IT → 🇮🇹). */
export const bandiera = (iso: string) => String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/**
 * Divide un numero in prefisso internazionale e numero nazionale (solo cifre).
 * Riconosce "+41 79…", "0041 79…" e i numeri senza prefisso (a cui assegna `prefissoBase`).
 */
export function dividiTelefono(valore: string, prefissoBase = '+39'): { prefisso: string; numero: string } {
  let t = (valore ?? '').trim().replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (!t.startsWith('+')) return { prefisso: prefissoBase, numero: t.replace(/\D/g, '') };
  const cifre = t.slice(1).replace(/\D/g, '');
  // il prefisso più lungo che corrisponde (es. +378 San Marino prima di +3…)
  const paese = [...PAESI].sort((a, b) => b.prefisso.length - a.prefisso.length).find((p) => cifre.startsWith(p.prefisso.slice(1)));
  if (paese) return { prefisso: paese.prefisso, numero: cifre.slice(paese.prefisso.length - 1) };
  return { prefisso: prefissoBase, numero: cifre };
}

/** Unisce prefisso e numero nel formato salvato (+39333…); vuoto se manca il numero. */
export const unisciTelefono = (prefisso: string, numero: string) => {
  const n = numero.replace(/\D/g, '');
  return n ? `${prefisso}${n}` : '';
};

/** Nome confrontabile: minuscole, senza accenti e spazi in più ("Maria  Rossì" = "maria rossi"). */
export const nomeConfrontabile = (nome: string, cognome: string) =>
  `${nome} ${cognome}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export interface Doppione<C> {
  cliente: C;
  /**
   * 'telefono' = stesso numero → bloccato;
   * 'nome' = stesso nome e cognome, e almeno uno dei due senza numero → bloccato;
   * 'omonimo' = stesso nome e cognome ma numeri diversi → può essere un'altra persona, si chiede conferma.
   */
  motivo: 'telefono' | 'nome' | 'omonimo';
}

/** Cerca tra i clienti uno già presente uguale a quello che si sta salvando (escluso sé stesso). */
export function trovaDoppione<C extends { id?: number; nome: string; cognome: string; telefono: string }>(
  nuovo: { id?: number; nome: string; cognome: string; telefono: string },
  clienti: C[],
  prefisso = '+39',
): Doppione<C> | null {
  const tel = normalizzaTelefono(nuovo.telefono, prefisso);
  const nome = nomeConfrontabile(nuovo.nome, nuovo.cognome);
  const altri = clienti.filter((c) => c.id == null || c.id !== nuovo.id);
  const stessoNumero = tel ? altri.find((c) => normalizzaTelefono(c.telefono, prefisso) === tel) : undefined;
  if (stessoNumero) return { cliente: stessoNumero, motivo: 'telefono' };
  const stessoNome = nome ? altri.filter((c) => nomeConfrontabile(c.nome, c.cognome) === nome) : [];
  const senzaNumero = stessoNome.find((c) => !tel || !normalizzaTelefono(c.telefono, prefisso));
  if (senzaNumero) return { cliente: senzaNumero, motivo: 'nome' };
  if (stessoNome.length) return { cliente: stessoNome[0], motivo: 'omonimo' };
  return null;
}
