import { describe, expect, it } from 'vitest';
import type { Appuntamento, Cliente, Impostazioni, SchedaColore } from '../types';
import { appuntamentiDelMese, daAvvisare, inReminder, grammiTonalita, grammiTotali, passaFiltroDurata, ricettaPer, testoConferma, testoMese, testoPreparazione, testoRicetta } from './messaggi';

const imp = {
  id: 'main',
  nomeSalone: 'Salone Bea',
  messaggio: '',
  messaggioConferma: 'Ciao {nome}, confermato {data} alle {ora} per: {servizio}.',
  messaggioMese: 'Ciao {nome}, i tuoi appuntamenti di {mese} da {salone}:',
  passo: 15,
  prefisso: '+39',
  settimana: [],
} as Impostazioni;
const maria: Cliente = { id: 1, nome: 'Maria', cognome: 'Rossi', telefono: '+393331234567', note: '' };

const app = (id: number, data: string, inizio: number, servizi: string[], extra: Partial<Appuntamento> = {}): Appuntamento => ({
  id,
  clientId: 1,
  data,
  inizio,
  fine: inizio + 60 * servizi.length,
  stato: 'prenotato',
  note: '',
  fasi: servizi.map((s, i) => ({ serviceId: i, servizio: s, nome: s, tipo: 'lavoro', inizio: inizio + 60 * i, durata: 60, staffId: 1 })),
  ...extra,
});

describe('messaggi WhatsApp', () => {
  it('conferma con i servizi nell’ordine scelto', () => {
    const a = app(1, '2026-12-05', 600, ['Taglio donna', 'Colore base']);
    expect(testoConferma(a, maria, imp)).toBe('Ciao Maria, confermato sabato 5 dicembre alle 10:00 per: Taglio donna, Colore base.');
  });

  it('riepilogo del mese: solo il cliente, solo il mese, esclusi annullati, in ordine', () => {
    const tutti = [
      app(1, '2026-12-19', 900, ['Piega']),
      app(2, '2026-12-05', 600, ['Colore base', 'Piega']),
      app(3, '2026-12-12', 600, ['Taglio'], { stato: 'annullato' }),
      app(4, '2027-01-09', 600, ['Taglio']),
      app(5, '2026-12-06', 600, ['Taglio'], { clientId: 2 }),
    ];
    const lista = appuntamentiDelMese(tutti, 1, '2026-12');
    expect(lista.map((a) => a.id)).toEqual([2, 1]);
    expect(testoMese(lista, maria, '2026-12', imp)).toBe(
      [
        'Ciao Maria, i tuoi appuntamenti di dicembre 2026 da Salone Bea:',
        '• sabato 5 dicembre alle 10:00: Colore base, Piega',
        '• sabato 19 dicembre alle 15:00: Piega',
      ].join('\n'),
    );
  });
});

describe('ricette colore', () => {
  const scheda = (id: number, data: string, extra: Partial<SchedaColore> = {}): SchedaColore => ({
    id,
    clientId: 1,
    data,
    brand: 'Wella',
    componenti: [
      { tonalita: '7/1', grammi: 30 },
      { tonalita: '8/0', grammi: 20 },
      { tonalita: ' ', grammi: 0 },
    ],
    ossigeno: '20 vol',
    grammiOssigeno: 75,
    note: '',
    ...extra,
  });

  it('descrive la ricetta e somma i grammi', () => {
    expect(testoRicetta(scheda(1, '2026-10-01'))).toBe('Wella · 7/1 30 g + 8/0 20 g · ossigeno 20 vol 75 g');
    expect(grammiTonalita(scheda(1, '2026-10-01'))).toBe(50);
    expect(grammiTotali(scheda(1, '2026-10-01'))).toBe(125);
  });

  it("usa la scheda dell'appuntamento, altrimenti l'ultima precedente del cliente", () => {
    const a = app(9, '2026-12-05', 600, ['Colore base']);
    const schede = [scheda(1, '2026-09-01'), scheda(2, '2026-11-01'), scheda(3, '2027-01-01'), scheda(4, '2026-11-20', { clientId: 2 })];
    expect(ricettaPer(a, schede)).toEqual({ scheda: schede[1], propria: false });
    const propria = scheda(5, '2026-12-05', { appuntamentoId: 9 });
    expect(ricettaPer(a, [...schede, propria])).toEqual({ scheda: propria, propria: true });
    expect(ricettaPer(a, [])).toEqual({ scheda: undefined, propria: false });
  });
});

describe('preparazione colori', () => {
  it('elenca orario, cliente, servizi e ricetta', () => {
    const a = app(1, '2026-12-05', 600, ['Colore base']);
    const scheda: SchedaColore = {
      clientId: 1,
      data: '2026-11-01',
      brand: 'Wella',
      componenti: [{ tonalita: '7/1', grammi: 40 }],
      ossigeno: '20 vol',
      grammiOssigeno: 60,
      note: 'radici',
    };
    expect(testoPreparazione('2026-12-05', [{ a, cliente: maria, ora: 600, scheda }, { a, ora: 660 }])).toBe(
      [
        'Preparazione colori di sabato 5 dicembre',
        '• 10:00 Maria Rossi — Colore base',
        '  Wella · 7/1 40 g · ossigeno 20 vol 60 g (radici)',
        '• 11:00 Cliente — Colore base',
        '  nessuna ricetta registrata',
      ].join('\n'),
    );
    expect(testoPreparazione('2026-12-05', [])).toBe('Preparazione colori di sabato 5 dicembre\nNessun colore da preparare.');
  });
});

describe('filtro per durata dei promemoria', () => {
  const lungo = (min: number) => ({ ...app(1, '2026-12-05', 600, ['X']), fine: 600 + min });
  it('di base mostra gli appuntamenti di almeno 1 ora', () => {
    expect(passaFiltroDurata(lungo(60))).toBe(true);
    expect(passaFiltroDurata(lungo(105))).toBe(true);
    expect(passaFiltroDurata(lungo(45))).toBe(false);
  });
  it('si può scegliere "meno di", "almeno N ore" o "tutti"', () => {
    expect(passaFiltroDurata(lungo(30), { verso: 'meno', minuti: 60 })).toBe(true);
    expect(passaFiltroDurata(lungo(60), { verso: 'meno', minuti: 60 })).toBe(false);
    expect(passaFiltroDurata(lungo(150), { verso: 'almeno', minuti: 180 })).toBe(false);
    expect(passaFiltroDurata(lungo(180), { verso: 'almeno', minuti: 180 })).toBe(true);
    expect(passaFiltroDurata(lungo(10), { verso: 'tutti', minuti: 60 })).toBe(true);
  });
});

describe('clienti da avvisare', () => {
  const app = (durata: number, avvisa?: boolean): Appuntamento => ({ clientId: 1, data: '2026-12-01', inizio: 600, fine: 600 + durata, stato: 'prenotato', note: '', fasi: [], avvisa });
  const normale = { nome: 'A', cognome: 'B', telefono: '', note: '' };
  const sempre = { ...normale, avvisaSempre: true };
  it("il flag del cliente vale se l'appuntamento non dice altro", () => {
    expect(daAvvisare(app(30), sempre)).toBe(true);
    expect(daAvvisare(app(30), normale)).toBe(false);
    expect(daAvvisare(app(30, false), sempre)).toBe(false);
    expect(daAvvisare(app(30, true), normale)).toBe(true);
  });
  it('i clienti da avvisare compaiono nei reminder qualunque sia la durata', () => {
    const filtro = { verso: 'almeno' as const, minuti: 60 };
    expect(inReminder(app(30), sempre, filtro)).toBe(true);
    expect(inReminder(app(30), normale, filtro)).toBe(false);
    expect(inReminder(app(90), normale, filtro)).toBe(true);
    expect(inReminder(app(30, false), sempre, filtro)).toBe(false);
  });
});
