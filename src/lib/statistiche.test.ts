import { describe, expect, it } from 'vitest';
import type { Appuntamento, Stato } from '../types';
import { calcola, daRichiamare, esitoDi, tassoAnnullati, tassoAssenze } from './statistiche';

const OGGI = '2026-11-20';
let n = 0;
const app = (clientId: number, data: string, stato: Stato = 'prenotato', fasi: Partial<Appuntamento['fasi'][number]>[] = [{}]): Appuntamento => ({
  id: ++n,
  clientId,
  data,
  inizio: 600,
  fine: 660,
  stato,
  note: '',
  fasi: fasi.map((f) => ({ serviceId: 1, servizio: 'Taglio', nome: 'Taglio', tipo: 'lavoro', inizio: 600, durata: 30, staffId: 1, ...f })),
});

describe('statistiche', () => {
  it('un prenotato già passato conta come fatto', () => {
    expect(esitoDi(app(1, '2026-11-19'), OGGI)).toBe('fatto');
    expect(esitoDi(app(1, '2026-11-20'), OGGI)).toBe('futuro');
    expect(esitoDi(app(1, '2026-11-19', 'assente'), OGGI)).toBe('assente');
  });

  it('conta esiti, tassi, servizi, operatori e clienti del periodo', () => {
    const tutti = [
      app(1, '2026-10-05'), // fuori periodo: cliente 1 non è nuovo
      app(1, '2026-11-03', 'completato', [{}, { serviceId: 2, servizio: 'Piega', nome: 'Piega', durata: 45, staffId: 2 }, { serviceId: 2, servizio: 'Piega', nome: 'Posa', tipo: 'posa', durata: 20, staffId: 2 }]),
      app(2, '2026-11-04', 'assente'),
      app(2, '2026-11-10', 'annullato'),
      app(3, '2026-11-12'),
      app(3, '2026-11-25'),
      app(4, '2026-11-15', 'annullato'),
    ];
    const s = calcola(tutti, '2026-11-01', '2026-11-30', OGGI);
    expect(s.conteggi).toEqual({ totale: 6, fatto: 2, futuro: 1, assente: 1, annullato: 2 });
    expect(tassoAssenze(s.conteggi)).toBeCloseTo(1 / 3);
    expect(tassoAnnullati(s.conteggi)).toBeCloseTo(2 / 6);
    expect(s.servizi).toEqual([
      { serviceId: 1, nome: 'Taglio', volte: 3, minuti: 90 },
      { serviceId: 2, nome: 'Piega', volte: 1, minuti: 65 },
    ]);
    expect(s.operatori).toEqual([
      { staffId: 1, appuntamenti: 3, minuti: 90 },
      { staffId: 2, appuntamenti: 1, minuti: 45 },
    ]);
    expect(s.clientiAttivi).toBe(3); // il cliente 4 ha solo annullato
    expect(s.clientiNuovi).toBe(2); // clienti 2 e 3
    const c3 = s.clienti.find((c) => c.clientId === 3)!;
    expect([c3.ultimaVisita, c3.prossimo]).toEqual(['2026-11-12', '2026-11-25']);
    expect(s.mesi.map((m) => m.mese)).toEqual(['2026-11']);
  });

  it('clienti da richiamare: niente visite recenti e niente in programma', () => {
    const tutti = [app(1, '2026-08-01'), app(2, '2026-08-01'), app(2, '2026-12-01'), app(3, '2026-11-01'), app(4, '2026-07-01', 'assente')];
    expect(daRichiamare(tutti, OGGI, 60)).toEqual([{ clientId: 1, ultimaVisita: '2026-08-01', visite: 1 }]);
  });
});
