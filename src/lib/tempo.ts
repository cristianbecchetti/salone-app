const pad = (n: number) => String(n).padStart(2, '0');

export const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const daHm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const aData = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const oggi = () => iso(new Date());
export const piuGiorni = (s: string, n: number) => {
  const d = aData(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const giornoSettimana = (s: string) => aData(s).getDay();
export const oraMinuti = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
/** lunedì della settimana che contiene la data */
export const lunedi = (s: string) => piuGiorni(s, -((giornoSettimana(s) + 6) % 7));

export const dataLunga = (s: string) =>
  aData(s).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
export const dataBreve = (s: string) =>
  aData(s).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
export const dataNum = (s: string) => aData(s).toLocaleDateString('it-IT');

export const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
/** ordine di visualizzazione: da lunedì a domenica */
export const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0];

export const minuti = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}′` : ''}` : `${m}′`;
