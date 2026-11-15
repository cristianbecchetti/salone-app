import { describe, expect, it } from 'vitest';
import { PAESI, bandiera, dividiTelefono, normalizzaTelefono, unisciTelefono } from './contatti';

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
