// Lettura del testo dalle foto, direttamente sul dispositivo (Tesseract, lingua italiana).
// Il lettore si scarica la prima volta (serve internet), poi resta nella cache del browser.

export interface Avanzamento {
  pagina: number;
  di: number;
  perc: number;
}

/** Legge il testo di ogni foto, nell'ordine. */
export async function leggiTestoFoto(foto: File[], avanza: (a: Avanzamento) => void): Promise<string[]> {
  const { createWorker } = await import('tesseract.js');
  let pagina = 1;
  const worker = await createWorker('ita', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') avanza({ pagina, di: foto.length, perc: Math.round(m.progress * 100) });
    },
  });
  const testi: string[] = [];
  try {
    for (const f of foto) {
      avanza({ pagina, di: foto.length, perc: 0 });
      const { data } = await worker.recognize(f);
      testi.push(data.text);
      pagina++;
    }
  } finally {
    await worker.terminate();
  }
  return testi;
}

export const erroreLettura = (e: unknown) =>
  `Lettura non riuscita: ${e instanceof Error ? e.message : e}. La prima volta serve internet per scaricare il lettore di testo (circa 15 MB).`;
