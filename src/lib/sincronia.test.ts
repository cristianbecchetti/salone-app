import { describe, expect, it } from 'vitest';
import { campiCambiati, forzaLocale, istantaneaVuota, nuovoId, sostituisci, unisci, type Istantanea, type Record_ } from './sincronia';

const ist = (dati: Istantanea['dati'], eliminati: Record<string, number> = {}): Istantanea => ({ ...istantaneaVuota(), dati, eliminati });
const cl = (id: number, nome: string, _agg?: number): Record_ => ({ id, nome, cognome: '', telefono: '', note: '', ...(_agg ? { _agg } : {}) });

describe('unione dei dati tra dispositivi', () => {
  it('nessuna differenza: niente da scrivere né da inviare', () => {
    const d = ist({ clienti: [cl(1, 'Maria', 10)] });
    const e = unisci(d, d);
    expect(e.daScrivere).toEqual([]);
    expect(e.daEliminare).toEqual([]);
    expect(e.inviare).toBe(false);
  });

  it('i nuovi record di entrambi i dispositivi vengono tenuti', () => {
    const tablet = ist({ clienti: [cl(1, 'Maria', 10), cl(2, 'Laura', 20)] });
    const telefono = ist({ clienti: [cl(1, 'Maria', 10), cl(3, 'Sara', 30)] });
    const e = unisci(tablet, telefono);
    expect(e.unita.dati.clienti!.map((c) => c.nome).sort()).toEqual(['Laura', 'Maria', 'Sara']);
    expect(e.daScrivere.map((x) => x.record.nome)).toEqual(['Sara']);
    expect(e.inviare).toBe(true);
  });

  it('se lo stesso record è cambiato su due dispositivi vince la modifica più recente', () => {
    const qui = ist({ clienti: [cl(1, 'Maria Rossi', 100)] });
    const file = ist({ clienti: [cl(1, 'Maria R.', 50)] });
    expect(unisci(qui, file).unita.dati.clienti![0].nome).toBe('Maria Rossi');
    expect(unisci(qui, file).inviare).toBe(true);
    const fileNuovo = ist({ clienti: [cl(1, 'Maria Bianchi', 200)] });
    const e = unisci(qui, fileNuovo);
    expect(e.daScrivere[0].record.nome).toBe('Maria Bianchi');
    expect(e.inviare).toBe(false);
  });

  it("un'eliminazione più recente toglie il record anche dagli altri dispositivi", () => {
    const qui = ist({ clienti: [cl(1, 'Maria', 10), cl(2, 'Laura', 10)] });
    const file = ist({ clienti: [cl(1, 'Maria', 10)] }, { 'clienti:2': 50 });
    const e = unisci(qui, file);
    expect(e.daEliminare).toEqual([{ tabella: 'clienti', chiave: 2 }]);
    expect(e.unita.dati.clienti!.map((c) => c.id)).toEqual([1]);
  });

  it('un record modificato dopo la sua eliminazione resta', () => {
    const qui = ist({ clienti: [cl(2, 'Laura', 100)] });
    const file = ist({}, { 'clienti:2': 50 });
    const e = unisci(qui, file);
    expect(e.unita.dati.clienti!.map((c) => c.nome)).toEqual(['Laura']);
    expect(e.inviare).toBe(true);
  });

  it("le impostazioni del dispositivo (token, chiave, dimensione testo…) non passano agli altri", () => {
    const qui = ist({ impostazioni: [{ id: 'main', nomeSalone: 'Vecchio', scalaTesto: 1.4, driveChiave: 'segreta', waToken: 'T', _agg: 10 }] });
    const file = ist({ impostazioni: [{ id: 'main', nomeSalone: 'Salone Bea', _agg: 20 }] });
    const e = unisci(qui, file);
    expect(e.daScrivere[0].record).toEqual({ id: 'main', nomeSalone: 'Salone Bea', _agg: 20, scalaTesto: 1.4, driveChiave: 'segreta', waToken: 'T' });
    // nel file condiviso non finiscono mai credenziali o preferenze del dispositivo
    const inviato = unisci(ist({ impostazioni: [{ id: 'main', nomeSalone: 'Nuovo', driveChiave: 'segreta', waToken: 'T', _agg: 30 }] }), file);
    expect(inviato.unita.dati.impostazioni).toEqual([{ id: 'main', nomeSalone: 'Nuovo', _agg: 30 }]);
  });

  it("l'ordine dei campi non conta", () => {
    const a = ist({ clienti: [{ id: 1, nome: 'Maria', note: '', _agg: 5 }] });
    const b = ist({ clienti: [{ note: '', _agg: 5, nome: 'Maria', id: 1 }] });
    expect(unisci(a, b).daScrivere).toEqual([]);
    expect(unisci(a, b).inviare).toBe(false);
  });

  it('gli id nuovi sono unici tra dispositivi e restano interi sicuri', () => {
    expect(nuovoId(1_800_000_000_000, 0.5)).toBe(1_800_000_000_000_500);
    expect(Number.isSafeInteger(nuovoId(4_000_000_000_000, 0.999))).toBe(true);
    expect(nuovoId(1000, 0.1)).not.toBe(nuovoId(1000, 0.2));
  });
});

describe('collegamento di un nuovo dispositivo e ripristino da file', () => {
  it('il nuovo dispositivo prende tutto dal file condiviso ma tiene le sue impostazioni di dispositivo', () => {
    const nuovo = ist({
      clienti: [cl(99, 'Prova', 500)],
      impostazioni: [{ id: 'main', nomeSalone: 'Il mio salone', driveUrl: 'u', driveChiave: 'k', scalaTesto: 1.4, _agg: 500 }],
    });
    const file = ist({ clienti: [cl(1, 'Maria', 10)], impostazioni: [{ id: 'main', nomeSalone: 'Salone Bea', _agg: 20 }] });
    const e = sostituisci(nuovo, file);
    expect(e.daEliminare).toEqual([{ tabella: 'clienti', chiave: 99 }]);
    expect(e.daScrivere.find((x) => x.tabella === 'clienti')!.record.nome).toBe('Maria');
    expect(e.daScrivere.find((x) => x.tabella === 'impostazioni')!.record).toEqual({
      id: 'main',
      nomeSalone: 'Salone Bea',
      _agg: 20,
      driveUrl: 'u',
      driveChiave: 'k',
      scalaTesto: 1.4,
    });
    expect(e.inviare).toBe(false);
  });

  it('dopo un ripristino i dati di questo dispositivo vincono e quelli in più nel file vengono eliminati', () => {
    const ripristinato = ist({ clienti: [cl(1, 'Maria', 5)] });
    const file = ist({ clienti: [cl(1, 'Maria cambiata', 900), cl(2, 'Laura', 900)] });
    const e = forzaLocale(ripristinato, file, 1000);
    expect(e.unita.dati.clienti).toEqual([{ ...cl(1, 'Maria'), _agg: 1000 }]);
    expect(e.unita.eliminati['clienti:2']).toBe(1000);
    // su un altro dispositivo che aveva le modifiche, l'unione porta allo stato ripristinato
    const altro = unisci(file, e.unita);
    expect(altro.daEliminare).toEqual([{ tabella: 'clienti', chiave: 2 }]);
    expect(altro.daScrivere[0].record.nome).toBe('Maria');
  });
});

describe('aggiornamenti senza cambiamenti reali', () => {
  it('conta solo i campi che cambiano davvero (le liste uguali no, _agg no)', () => {
    const prima = { id: 'main', settimana: [[{ da: 1, a: 2 }]], syncUltima: 'x', _agg: 1 };
    expect(campiCambiati({ settimana: [[{ a: 2, da: 1 }]], syncUltima: 'y', _agg: 5 }, prima)).toEqual(['syncUltima']);
    expect(campiCambiati({ settimana: [[{ da: 1, a: 3 }]] }, prima)).toEqual(['settimana']);
    expect(campiCambiati({ nome: undefined }, { nome: undefined })).toEqual([]);
  });
});
