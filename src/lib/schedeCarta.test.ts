import { describe, expect, it } from 'vitest';
import { leggiSchede } from './schedeCarta';

const OGGI = '2026-11-28';

describe('schede colore cartacee', () => {
  it('divide per data e legge tonalità, grammi, ossigeno, brand e note', () => {
    const { intestazione, schede } = leggiSchede(
      [
        'ROSSI MARIA',
        'tel 333 1234567',
        '12/03/24 Wella Koleston',
        '7/1 30g + 8/0 20 gr',
        'ossigeno 20 vol 75g',
        'posa 35 min, radici',
        '05.09.2025',
        "6.34 40 g  L'Oréal Majirel",
        'ox 6% 60',
      ].join('\n'),
      OGGI,
    );
    expect(intestazione).toEqual(['ROSSI MARIA', 'tel 333 1234567']);
    expect(schede).toHaveLength(2);
    expect(schede[0]).toMatchObject({
      data: '2024-03-12',
      brand: 'Wella Koleston',
      componenti: [
        { tonalita: '7/1', grammi: 30 },
        { tonalita: '8/0', grammi: 20 },
      ],
      ossigeno: '20 vol',
      grammiOssigeno: 75,
    });
    expect(schede[0].note).toContain('radici');
    expect(schede[1]).toMatchObject({
      data: '2025-09-05',
      brand: "L'Oréal Majirel",
      componenti: [{ tonalita: '6.34', grammi: 40 }],
      ossigeno: '6%',
      grammiOssigeno: 60,
    });
  });

  it('corregge le lettere scambiate per cifre e accetta tonalità con lettere', () => {
    const { schede } = leggiSchede('1/2/2026\n7/l 3O g\n6N 40', OGGI);
    expect(schede[0].componenti).toEqual([
      { tonalita: '7/1', grammi: 30 },
      { tonalita: '6N', grammi: 40 },
    ]);
  });

  it('ricetta senza data: una scheda con la data da scegliere; il brand passa alla scheda successiva', () => {
    const { schede } = leggiSchede('Goldwell 5/0 30g\n20 vol 60g\n10/10/25\n5/0 35g', OGGI);
    expect(schede.map((s) => [s.data, s.brand, s.componenti.length])).toEqual([
      ['', 'Goldwell', 1],
      ['2025-10-10', 'Goldwell', 1],
    ]);
  });

  it('la "g" letta come 9 non gonfia i grammi', () => {
    const { schede } = leggiSchede('1/2/26\n5/0 359  6N 15g\n30 vol 759', OGGI);
    expect(schede[0].componenti).toEqual([
      { tonalita: '5/0', grammi: 35 },
      { tonalita: '6N', grammi: 15 },
    ]);
    expect(schede[0].grammiOssigeno).toBe(75);
    // tinta e ossigeno sulla stessa riga: i grammi della tinta restano alla tinta
    expect(leggiSchede('1/2/26\n7/1 30 + 20 vol 60', OGGI).schede[0]).toMatchObject({ componenti: [{ tonalita: '7/1', grammi: 30 }], ossigeno: '20 vol', grammiOssigeno: 60 });
    // valori plausibili restano com'erano
    expect(leggiSchede('1/2/26\n7/1 90\nox 20 vol 150', OGGI).schede[0]).toMatchObject({ componenti: [{ tonalita: '7/1', grammi: 90 }], grammiOssigeno: 150 });
  });

  it('scarta date impossibili', () => {
    expect(leggiSchede('45/13/24 7/1 30g', OGGI).schede[0].data).toBe('');
  });
});
