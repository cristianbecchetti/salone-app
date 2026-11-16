import { describe, expect, it } from 'vitest';
import type { Appuntamento, Fascia, Operatore } from '../types';
import {
  fasceSalone,
  impegniDa,
  intersezione,
  nelleFasce,
  primoSlot,
  sottrai,
  assente,
  prossimaApertura,
  trovaSlot,
  turnoOperatore,
  verifica,
  type FaseRichiesta,
} from './slots';

const h = (ore: number, min = 0) => ore * 60 + min;
const MATTINA_POMERIGGIO: Fascia[] = [
  { da: h(9), a: h(13) },
  { da: h(15), a: h(19) },
];
// 0 = domenica … lunedì e domenica chiuso
const SETTIMANA: Fascia[][] = [[], [], MATTINA_POMERIGGIO, MATTINA_POMERIGGIO, MATTINA_POMERIGGIO, MATTINA_POMERIGGIO, [{ da: h(9), a: h(18) }]];

const COLORE: FaseRichiesta[] = [
  { tipo: 'lavoro', durata: 30, competenza: 'Colore' },
  { tipo: 'posa', durata: 30 },
  { tipo: 'lavoro', durata: 45, competenza: 'Piega' },
];
const TAGLIO_DONNA: FaseRichiesta[] = [
  { tipo: 'lavoro', durata: 30, competenza: 'Taglio' },
  { tipo: 'lavoro', durata: 30, competenza: 'Piega' },
];
const op = (id: number, extra: Partial<Operatore> = {}): Operatore => ({
  id,
  nome: `Op${id}`,
  colore: '#000',
  competenze: ['Colore', 'Piega'],
  turni: [null, null, null, null, null, null, null],
  assenze: [],
  attivo: true,
  ...extra,
});
const coloreAlle = (inizio: number, staffId: number, id = 1): Appuntamento => ({
  id,
  clientId: 1,
  data: '2026-11-17',
  inizio,
  fine: inizio + 105,
  stato: 'prenotato',
  note: '',
  fasi: [
    { serviceId: 1, servizio: 'Colore base', nome: 'Applicazione', tipo: 'lavoro', inizio, durata: 30, staffId, competenza: 'Colore' },
    { serviceId: 1, servizio: 'Colore base', nome: 'Posa', tipo: 'posa', inizio: inizio + 30, durata: 30, staffId },
    { serviceId: 1, servizio: 'Colore base', nome: 'Piega', tipo: 'lavoro', inizio: inizio + 60, durata: 45, staffId, competenza: 'Piega' },
  ],
});

describe('orari del salone', () => {
  it('usa la settimana tipo', () => {
    expect(fasceSalone('2026-11-17', SETTIMANA, [])).toEqual(MATTINA_POMERIGGIO); // martedì
    expect(fasceSalone('2026-11-16', SETTIMANA, [])).toEqual([]); // lunedì
  });
  it("l'eccezione vince sulla settimana tipo", () => {
    const ecc = [
      { data: '2026-11-17', fasce: [], nota: 'chiuso' },
      { data: '2026-11-16', fasce: [{ da: h(10), a: h(14) }], nota: 'apertura straordinaria' },
    ];
    expect(fasceSalone('2026-11-17', SETTIMANA, ecc)).toEqual([]);
    expect(fasceSalone('2026-11-16', SETTIMANA, ecc)).toEqual([{ da: h(10), a: h(14) }]);
  });
  it('trova il prossimo giorno di apertura saltando le chiusure', () => {
    // sabato 14 → domenica e lunedì chiusi → martedì 17
    expect(prossimaApertura('2026-11-14', SETTIMANA, [])).toBe('2026-11-17');
    expect(prossimaApertura('2026-11-14', SETTIMANA, [{ data: '2026-11-17', fasce: [], nota: '' }])).toBe('2026-11-18');
  });
  it('interseca le fasce', () => {
    expect(intersezione([{ da: h(8), a: h(14) }], MATTINA_POMERIGGIO)).toEqual([{ da: h(9), a: h(13) }]);
  });
});

describe('turno operatore', () => {
  const salone = MATTINA_POMERIGGIO;
  it('segue il salone se non ha turni propri', () => {
    expect(turnoOperatore(op(1), '2026-11-17', salone)).toEqual(salone);
  });
  it('rispetta turni personali, giorni liberi e assenze', () => {
    const turni = [null, null, [{ da: h(9), a: h(13) }], [], null, null, null];
    expect(turnoOperatore(op(1, { turni }), '2026-11-17', salone)).toEqual([{ da: h(9), a: h(13) }]);
    expect(turnoOperatore(op(1, { turni }), '2026-11-18', salone)).toEqual([]);
    const assenze = [{ dal: '2026-11-16', al: '2026-11-20', nota: 'ferie' }];
    expect(turnoOperatore(op(1, { assenze }), '2026-11-17', salone)).toEqual([]);
  });
});

describe('trovaSlot', () => {
  const salone = MATTINA_POMERIGGIO;
  const uno = [{ id: 1, turno: salone, competenze: ['Colore', 'Piega', 'Taglio'] }];

  it("tiene l'intero appuntamento dentro una fascia di apertura", () => {
    const slot = trovaSlot({ fasi: COLORE, salone, operatori: uno, impegni: [], passo: 15 });
    const inizi = slot.map((s) => s.inizio);
    expect(inizi[0]).toBe(h(9));
    expect(inizi).toContain(h(11, 15)); // 11:15 + 1h45 = 13:00
    expect(inizi).not.toContain(h(11, 30)); // sforerebbe nella pausa
    expect(inizi).toContain(h(15));
    expect(Math.max(...inizi)).toBe(h(17, 15));
  });

  it("durante la posa l'operatore può iniziare un altro cliente", () => {
    const impegni = impegniDa([coloreAlle(h(9), 1)]);
    // occupato 9:00–9:30 e 10:00–10:45, libero 9:30–10:00
    const taglio30 = trovaSlot({ fasi: [{ tipo: 'lavoro', durata: 30 }], salone, operatori: uno, impegni, passo: 15 });
    const inizi = taglio30.map((s) => s.inizio);
    expect(inizi).toContain(h(9, 30));
    expect(inizi).not.toContain(h(9));
    expect(inizi).not.toContain(h(9, 15));
    expect(inizi).not.toContain(h(9, 45));
    expect(inizi).not.toContain(h(10, 30));
    expect(inizi).toContain(h(10, 45));
  });

  it('incastra due colori sullo stesso operatore sfruttando le pose', () => {
    const impegni = impegniDa([coloreAlle(h(9), 1)]);
    const inizi = trovaSlot({ fasi: COLORE, salone, operatori: uno, impegni, passo: 15 }).map((s) => s.inizio);
    // 9:30: applicazione 9:30–10:00 (libero), posa 10:00–10:30, piega 10:30–11:15 → si sovrappone a 10:00–10:45
    expect(inizi).not.toContain(h(9, 30));
    // 10:45 è il primo inizio completamente libero
    expect(inizi[0]).toBe(h(10, 45));
  });

  it('una piega più lunga riduce gli slot', () => {
    const lunga = [...COLORE.slice(0, 2), { tipo: 'lavoro' as const, durata: 60 }];
    const inizi = trovaSlot({ fasi: lunga, salone, operatori: uno, impegni: [], passo: 15 }).map((s) => s.inizio);
    expect(inizi).toContain(h(11));
    expect(inizi).not.toContain(h(11, 15));
  });

  it('propone un altro operatore quando il primo è occupato e segnala la skill', () => {
    const impegni = impegniDa([coloreAlle(h(9), 1)]);
    const due = [...uno, { id: 2, turno: salone, competenze: [] as string[] }];
    const base = { fasi: COLORE, salone, operatori: due, impegni, passo: 15 };
    // senza skill non viene proposto, a meno di chiederlo
    expect(trovaSlot(base).filter((s) => s.inizio === h(9))).toEqual([]);
    const alle9 = trovaSlot({ ...base, ancheSenzaSkill: true }).filter((s) => s.inizio === h(9));
    expect(alle9).toEqual([{ inizio: h(9), fine: h(10, 45), staff: [2, null, 2], haSkill: false }]);
  });

  it('divide il servizio tra operatori con skill diverse (taglio a uno, piega a un altro)', () => {
    const squadra = [
      { id: 1, turno: salone, competenze: ['Taglio'] },
      { id: 2, turno: salone, competenze: ['Piega'] },
    ];
    const base = { fasi: TAGLIO_DONNA, salone, operatori: squadra, passo: 15 };
    const liberi = trovaSlot({ ...base, impegni: [] });
    expect(liberi.length).toBeGreaterThan(0);
    expect(liberi.every((s) => s.haSkill && s.staff[0] === 1 && s.staff[1] === 2)).toBe(true);

    // chi fa la piega è occupato 9:30–10:00 → salta le 9:00 e le 9:15, non le 9:30
    const inizi = trovaSlot({ ...base, impegni: [{ staffId: 2, da: h(9, 30), a: h(10) }] }).map((s) => s.inizio);
    expect(inizi).not.toContain(h(9));
    expect(inizi).not.toContain(h(9, 15));
    expect(inizi[0]).toBe(h(9, 30));
  });

  it('propone sia il singolo operatore sia la squadra quando entrambi sono possibili', () => {
    const squadra = [
      { id: 1, turno: salone, competenze: ['Taglio', 'Piega'] },
      { id: 2, turno: salone, competenze: ['Piega'] },
    ];
    const alle9 = trovaSlot({ fasi: TAGLIO_DONNA, salone, operatori: squadra, impegni: [], passo: 15 }).filter((s) => s.inizio === h(9));
    expect(alle9.map((s) => s.staff)).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });

  it('ignora appuntamenti annullati e quello in modifica', () => {
    const annullato = { ...coloreAlle(h(9), 1), stato: 'annullato' as const };
    expect(impegniDa([annullato])).toEqual([]);
    expect(impegniDa([coloreAlle(h(9), 1, 7)], 7)).toEqual([]);
  });

  it('non propone orari già passati e nulla se il salone è chiuso', () => {
    const slot = trovaSlot({ fasi: COLORE, salone, operatori: uno, impegni: [], passo: 15, nonPrimaDi: h(10, 5) });
    expect(slot[0].inizio).toBe(h(10, 15));
    expect(trovaSlot({ fasi: COLORE, salone: [], operatori: uno, impegni: [], passo: 15 })).toEqual([]);
  });
});

describe('verifica (avvisi non bloccanti)', () => {
  const salone = MATTINA_POMERIGGIO;
  const fasi = (inizio: number, staffId: number | null) =>
    coloreAlle(inizio, 1).fasi.map((f) => ({ ...f, staffId: f.tipo === 'lavoro' ? staffId : null }));

  it('nessun avviso per uno slot valido', () => {
    expect(verifica({ data: '2026-11-17', fasi: fasi(h(9), 1), salone, operatori: [op(1)], impegni: [] })).toEqual([]);
  });
  it('segnala fuori orario, occupato, senza skill e non assegnato', () => {
    const fuori = verifica({ data: '2026-11-17', fasi: fasi(h(12), 1), salone, operatori: [op(1)], impegni: [] });
    expect(fuori.join(' ')).toMatch(/orario di apertura/);

    const impegni = impegniDa([coloreAlle(h(9), 1)]);
    const occupato = verifica({ data: '2026-11-17', fasi: fasi(h(9), 1), salone, operatori: [op(1)], impegni });
    expect(occupato.join(' ')).toMatch(/già occupato/);

    const senzaSkill = verifica({ data: '2026-11-17', fasi: fasi(h(9), 1), salone, operatori: [op(1, { competenze: ['Colore'] })], impegni: [] });
    expect(senzaSkill).toEqual(['Op1 non ha la skill "Piega".']);

    const nessuno = verifica({ data: '2026-11-17', fasi: fasi(h(9), null), salone, operatori: [op(1)], impegni: [] });
    expect(nessuno.join(' ')).toMatch(/Nessun operatore/);
  });
});

describe('fasce orarie in prenotazione', () => {
  const mattina = { da: h(9), a: h(13) };
  const sera = { da: h(17), a: h(20) };
  it('filtra per orario di inizio; senza fasce scelte passa tutto', () => {
    expect(nelleFasce(h(9), [mattina])).toBe(true);
    expect(nelleFasce(h(12, 45), [mattina])).toBe(true);
    expect(nelleFasce(h(13), [mattina])).toBe(false);
    expect(nelleFasce(h(18), [mattina, sera])).toBe(true);
    expect(nelleFasce(h(15), [])).toBe(true);
  });

  it('il primo disponibile nelle fasce: orario più presto, poi un solo operatore', () => {
    const salone = MATTINA_POMERIGGIO;
    const operatori = [
      { id: 1, turno: salone, competenze: ['Colore', 'Piega'] },
      { id: 2, turno: salone, competenze: ['Piega'] },
    ];
    const slot = trovaSlot({ fasi: COLORE, salone, operatori, impegni: [], passo: 15 });
    const pomeriggio = slot.filter((s) => nelleFasce(s.inizio, [{ da: h(15), a: h(19) }]));
    const primo = primoSlot(pomeriggio)!;
    expect(primo.inizio).toBe(h(15));
    expect(primo.staff).toEqual([1, null, 1]);
    expect(primoSlot([])).toBeUndefined();
  });
});

describe('assenze per fascia oraria', () => {
  const salone = MATTINA_POMERIGGIO;
  it("sottrae l'assenza dal turno", () => {
    expect(sottrai(salone, [{ da: h(10), a: h(11) }])).toEqual([
      { da: h(9), a: h(10) },
      { da: h(11), a: h(13) },
      { da: h(15), a: h(19) },
    ]);
    expect(sottrai(salone, [{ da: h(12), a: h(16) }])).toEqual([
      { da: h(9), a: h(12) },
      { da: h(16), a: h(19) },
    ]);
  });

  it("vale ogni giorno del periodo; senza orario resta l'assenza di tutto il giorno", () => {
    const o = op(1, {
      assenze: [
        { dal: '2026-11-17', al: '2026-11-18', nota: 'medico', da: h(15), a: h(17) },
        { dal: '2026-11-20', al: '2026-11-20', nota: 'ferie' },
      ],
    });
    expect(turnoOperatore(o, '2026-11-18', salone)).toEqual([
      { da: h(9), a: h(13) },
      { da: h(17), a: h(19) },
    ]);
    expect(turnoOperatore(o, '2026-11-19', salone)).toEqual(salone);
    expect(turnoOperatore(o, '2026-11-20', salone)).toEqual([]);
    expect(assente(o, '2026-11-17')).toBe(false);
    expect(assente(o, '2026-11-20')).toBe(true);
  });

  it("niente slot nell'orario di assenza, e avviso chiaro se si forza", () => {
    const o = op(1, { assenze: [{ dal: '2026-11-17', al: '2026-11-17', nota: '', da: h(9), a: h(10) }] });
    const slot = trovaSlot({
      fasi: [{ tipo: 'lavoro', durata: 30 }],
      salone,
      operatori: [{ id: 1, turno: turnoOperatore(o, '2026-11-17', salone), competenze: [] }],
      impegni: [],
      passo: 15,
    });
    expect(slot[0].inizio).toBe(h(10));
    const avvisi = verifica({
      data: '2026-11-17',
      fasi: [{ nome: 'Taglio', tipo: 'lavoro', inizio: h(9, 30), durata: 30, staffId: 1 }],
      salone,
      operatori: [o],
      impegni: [],
    });
    expect(avvisi).toEqual(['Op1 è assente dalle 09:00 alle 10:00.']);
  });
});
