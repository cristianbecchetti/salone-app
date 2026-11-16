import { describe, expect, it } from 'vitest';
import { PAESI, bandiera, dividiTelefono, normalizzaTelefono, trovaDoppione, unisciTelefono } from './contatti';

describe('numero di telefono con prefisso del paese', () => {
  it("l'Italia è il primo paese, gli altri in ordine alfabetico, senza doppioni", () => {
    expect(PAESI[0]).toEqual({ iso: 'IT', nome: 'Italia', prefisso: '+39' });
    const altri = PAESI.slice(1).map((p) => p.nome);
    expect(altri).toEqual([...altri].sort((a, b) => a.localeCompare(b, 'it')));
    expect(new Set(PAESI.map((p) => p.iso)).size).toBe(PAESI.length);
  });

  it('riconosce il prefisso in tutte le forme e tiene solo le cifre del numero', () => {
    expect(dividiTelefono('+39 333 123 4567')).toEqual({ prefisso: '+39', numero: '3331234567' });
    expect(dividiTelefono('0041 79 123 45 67')).toEqual({ prefisso: '+41', numero: '791234567' });
    expect(dividiTelefono('+378 0549 123456')).toEqual({ prefisso: '+378', numero: '0549123456' });
    expect(dividiTelefono('+1 (415) 555-0100')).toEqual({ prefisso: '+1', numero: '4155550100' });
  });

  it('senza prefisso usa quello predefinito; numero vuoto resta vuoto', () => {
    expect(dividiTelefono('333 1234567')).toEqual({ prefisso: '+39', numero: '3331234567' });
    expect(dividiTelefono('', '+41')).toEqual({ prefisso: '+41', numero: '' });
    expect(unisciTelefono('+41', '079 123 45 67')).toBe('+410791234567');
    expect(unisciTelefono('+39', '  ')).toBe('');
  });

  it('è coerente con la normalizzazione già usata nel salvataggio', () => {
    const { prefisso, numero } = dividiTelefono('+39 333 1234567');
    expect(normalizzaTelefono(unisciTelefono(prefisso, numero))).toBe('+393331234567');
  });

  it('bandiera dal codice del paese', () => {
    expect(bandiera('IT')).toBe('🇮🇹');
    expect(bandiera('ch')).toBe('🇨🇭');
  });
});

describe('clienti già presenti', () => {
  const clienti = [
    { id: 1, nome: 'Maria', cognome: 'Rossi', telefono: '+393331234567' },
    { id: 2, nome: 'Laura', cognome: 'Bianchi', telefono: '' },
  ];
  it('stesso numero (scritto in qualsiasi modo) → bloccato', () => {
    expect(trovaDoppione({ nome: 'Mary', cognome: 'R', telefono: '333 123 4567' }, clienti)?.motivo).toBe('telefono');
    expect(trovaDoppione({ nome: 'X', cognome: 'Y', telefono: '0039 333 1234567' }, clienti)?.cliente.id).toBe(1);
  });
  it('stesso nome e cognome (maiuscole, accenti, spazi) senza numero da una parte → bloccato', () => {
    expect(trovaDoppione({ nome: ' maria ', cognome: 'ROSSI', telefono: '' }, clienti)?.motivo).toBe('nome');
    expect(trovaDoppione({ nome: 'Laura', cognome: 'Bianchì', telefono: '+393470000000' }, clienti)?.motivo).toBe('nome');
  });
  it('stesso nome ma numero diverso → omonimo da confermare', () => {
    expect(trovaDoppione({ nome: 'Maria', cognome: 'Rossi', telefono: '+393470000000' }, clienti)?.motivo).toBe('omonimo');
  });
  it('nessun doppione per un cliente nuovo o per sé stesso in modifica', () => {
    expect(trovaDoppione({ nome: 'Sara', cognome: 'Verdi', telefono: '+393479999999' }, clienti)).toBeNull();
    expect(trovaDoppione({ id: 1, nome: 'Maria', cognome: 'Rossi', telefono: '+393331234567' }, clienti)).toBeNull();
  });
});
