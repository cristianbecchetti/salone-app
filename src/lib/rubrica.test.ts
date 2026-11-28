import { describe, expect, it } from 'vitest';
import { estraiVoci, proponi, punteggio, trovaNumero } from './rubrica';

describe('rubrica cartacea', () => {
  it('trova il numero nella riga anche con spazi, punti e lettere scambiate', () => {
    expect(trovaNumero('Rossi Maria 333 123 4567')).toEqual({ numero: '3331234567', resto: 'Rossi Maria' });
    expect(trovaNumero('Bianchi Laura - 347.12.34.S6O')?.numero).toBe('3471234560');
    expect(trovaNumero('Verdi Sara tel. +39 340/1112223')?.numero).toBe('+393401112223');
    expect(trovaNumero('Via Roma 12')).toBeNull();
  });

  it('estrae le voci, anche con nome e numero su due righe', () => {
    const voci = estraiVoci('RUBRICA\nRossi Maria 333 123 4567\nNeri Giulia\n339 8765432\n\n12/05\nGallo Anna cell 3201234567');
    expect(voci.map((v) => [v.nome, v.numero])).toEqual([
      ['Rossi Maria', '3331234567'],
      ['Neri Giulia', '3398765432'],
      ['Gallo Anna', '3201234567'],
    ]);
  });

  it('abbina il nome letto al cliente, tollerando ordine, iniziali e una lettera sbagliata', () => {
    const maria = { nome: 'Maria', cognome: 'Rossi' };
    expect(punteggio('Rossi Maria', maria)).toBe(1);
    expect(punteggio('Maria Rosi', maria)).toBeGreaterThanOrEqual(0.75);
    expect(punteggio('Rossi M.', maria)).toBeLessThan(0.75);
    expect(punteggio('Bianchi Maria', maria)).toBe(0);
  });

  it('propone solo clienti senza telefono, una volta sola, e segnala i numeri già usati', () => {
    const clienti = [
      { id: 1, nome: 'Maria', cognome: 'Rossi', telefono: '' },
      { id: 2, nome: 'Laura', cognome: 'Bianchi', telefono: '+393470000000' },
      { id: 3, nome: 'Giulia', cognome: 'Neri', telefono: '' },
    ];
    const p = proponi(
      estraiVoci('Rossi Maria 333 1234567\nBianchi Laura 347 1111111\nRossi M. 333 9999999\nNeri Giulia 347 0000000\nFerri Ugo 320 1231231'),
      clienti,
    );
    expect(p.map((x) => [x.voce.nome, x.clientId, x.esito, x.telefono, x.giaUsatoDa])).toEqual([
      ['Rossi Maria', 1, 'sicuro', '+393331234567', undefined],
      ['Bianchi Laura', undefined, 'nessuno', '+393471111111', undefined], // ha già il numero: non si tocca
      ['Rossi M.', undefined, 'nessuno', '+393339999999', undefined], // Maria Rossi va alla voce più somigliante
      ['Neri Giulia', 3, 'sicuro', '+393470000000', 2],
      ['Ferri Ugo', undefined, 'nessuno', '+393201231231', undefined],
    ]);
  });
});
