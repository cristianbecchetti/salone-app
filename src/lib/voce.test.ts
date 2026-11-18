import { describe, expect, it } from 'vitest';
import type { Cliente, Operatore, Servizio } from '../types';
import { interpreta, leggiData, leggiOra, type Contesto } from './voce';

// mercoledì 18 novembre 2026
const OGGI = '2026-11-18';

describe('date dette a voce', () => {
  it('giorni relativi e della settimana', () => {
    expect(leggiData('domani', OGGI)).toBe('2026-11-19');
    expect(leggiData('dopodomani', OGGI)).toBe('2026-11-20');
    expect(leggiData('oggi', OGGI)).toBe(OGGI);
    expect(leggiData('giovedì', OGGI)).toBe('2026-11-19');
    expect(leggiData('mercoledì', OGGI)).toBe(OGGI);
    expect(leggiData('mercoledì prossimo', OGGI)).toBe('2026-11-25');
    expect(leggiData('lunedì', OGGI)).toBe('2026-11-23');
  });
  it('date precise (anche nel mese o anno successivo)', () => {
    expect(leggiData('il 25 novembre', OGGI)).toBe('2026-11-25');
    expect(leggiData('3 gennaio', OGGI)).toBe('2027-01-03');
    expect(leggiData('il 10', OGGI)).toBe('2026-12-10');
    expect(leggiData('il 20', OGGI)).toBe('2026-11-20');
    expect(leggiData('25/12', OGGI)).toBe('2026-12-25');
    expect(leggiData('ventuno novembre', OGGI)).toBe('2026-11-21');
    expect(leggiData('appuntamenti', OGGI)).toBeNull();
    expect(leggiData('31 novembre', OGGI)).toBeNull();
  });
});

describe('ore dette a voce', () => {
  it('in cifre e a parole, con i minuti', () => {
    expect(leggiOra('alle 10')).toBe(600);
    expect(leggiOra('alle 10:30')).toBe(630);
    expect(leggiOra('alle 10 e mezza')).toBe(630);
    expect(leggiOra('alle dieci e un quarto')).toBe(615);
    expect(leggiOra('alle 15 e 45')).toBe(945);
    expect(leggiOra('a mezzogiorno')).toBe(720);
    expect(leggiOra('nessuna ora')).toBeNull();
  });
  it('"alle 3" è pomeriggio', () => {
    expect(leggiOra('alle 3')).toBe(900);
    expect(leggiOra('alle tre e mezza')).toBe(930);
  });
});

const cliente = (id: number, nome: string, cognome: string): Cliente => ({ id, nome, cognome, telefono: '', note: '' });
const servizio = (id: number, nome: string): Servizio => ({ id, nome, categoria: '', fasi: [], attivo: true });
const operatore = (id: number, nome: string): Operatore => ({ id, nome, colore: '', competenze: [], turni: [], assenze: [], attivo: true });
const ctx: Contesto = {
  oggi: OGGI,
  clienti: [cliente(1, 'Maria', 'Rossi'), cliente(2, 'Laura', 'Bianchi'), cliente(3, 'Maria', 'Verdi')],
  servizi: [servizio(1, 'Taglio donna'), servizio(2, 'Taglio uomo'), servizio(3, 'Piega'), servizio(4, 'Colore base')],
  operatori: [operatore(1, 'Operatore 1'), operatore(2, 'Giulia')],
  fasce: [
    { nome: 'Mattina', da: 540, a: 780 },
    { nome: 'Pomeriggio', da: 780, a: 1020 },
  ],
};
const nomi = (c: { clienti?: Cliente[] }) => (c.clienti ?? []).map((x) => `${x.nome} ${x.cognome}`);

describe('comandi', () => {
  it('agenda di un giorno, anche per operatore', () => {
    expect(interpreta('Appuntamenti di domani', ctx)).toEqual({ tipo: 'agenda', data: '2026-11-19', staffId: undefined });
    expect(interpreta("Chi c'è giovedì con Giulia?", ctx)).toEqual({ tipo: 'agenda', data: '2026-11-19', staffId: 2 });
    expect(interpreta('cosa abbiamo oggi', ctx)).toMatchObject({ tipo: 'agenda', data: OGGI });
  });

  it('prenotazione completa: servizio, cliente, giorno, ora, operatore', () => {
    expect(interpreta('Prenota taglio donna per Maria Rossi giovedì alle 10 con Giulia', ctx)).toMatchObject({
      tipo: 'prenota',
      serviceIds: [1],
      data: '2026-11-19',
      inizio: 600,
      staffId: 2,
    });
    expect(nomi(interpreta('Prenota taglio donna per Maria Rossi giovedì alle 10', ctx) as never)).toEqual(['Maria Rossi']);
  });

  it('prenotazione con più servizi e cliente non in rubrica', () => {
    const c = interpreta('fissa colore base e piega per Sara domani alle 3', ctx);
    expect(c).toMatchObject({ tipo: 'prenota', serviceIds: [4, 3], data: '2026-11-19', inizio: 900, nomeSentito: 'sara' });
    expect(nomi(c as never)).toEqual([]);
  });

  it('primo posto libero, con fascia oraria e operatore', () => {
    expect(interpreta('primo libero per colore base la mattina', ctx)).toMatchObject({
      tipo: 'libero',
      serviceIds: [4],
      fascia: { nome: 'Mattina' },
      dal: OGGI,
    });
    expect(interpreta('primo posto disponibile per piega con Giulia', ctx)).toMatchObject({ tipo: 'libero', serviceIds: [3], staffId: 2 });
  });

  it('domande sui clienti', () => {
    expect(interpreta('telefono di Laura', ctx)).toMatchObject({ tipo: 'telefono' });
    expect(nomi(interpreta('telefono di Laura', ctx) as never)).toEqual(['Laura Bianchi']);
    expect(nomi(interpreta('numero di Maria', ctx) as never)).toEqual(['Maria Rossi', 'Maria Verdi']);
    expect(interpreta('scheda colore di Maria Rossi', ctx)).toMatchObject({ tipo: 'scheda' });
    expect(interpreta('che colore ha fatto Rossi', ctx)).toMatchObject({ tipo: 'scheda' });
    expect(interpreta('ultima volta di Maria Rossi', ctx)).toMatchObject({ tipo: 'ultimo' });
    expect(interpreta('quando viene Laura', ctx)).toMatchObject({ tipo: 'prossimo' });
    expect(interpreta('appuntamenti di Laura Bianchi', ctx)).toMatchObject({ tipo: 'prossimo' });
  });

  it('navigazione, aiuto e frasi non capite', () => {
    expect(interpreta('apri clienti', ctx)).toEqual({ tipo: 'apri', pagina: 'clienti' });
    expect(interpreta('vai alla pagina colori', ctx)).toEqual({ tipo: 'apri', pagina: 'colori' });
    expect(interpreta('aiuto', ctx)).toEqual({ tipo: 'aiuto' });
    expect(interpreta('buongiorno', ctx)).toMatchObject({ tipo: 'sconosciuto' });
  });
});
