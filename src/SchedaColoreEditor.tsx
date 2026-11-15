import { useState } from 'react';
import { db } from './db';
import type { SchedaColore } from './types';
import { grammiTonalita, grammiTotali } from './lib/messaggi';
import { Campo, Modale } from './ui';
import { SceltaData } from './scelte';

const num = (v: string) => Math.max(0, Math.round(Number(v.replace(',', '.')) || 0));

/** Nuova scheda: copia la ricetta di partenza (se c'è) con la data indicata. */
export function nuovaScheda(clientId: number, data: string, da?: SchedaColore, appuntamentoId?: number): SchedaColore {
  return {
    clientId,
    data,
    appuntamentoId,
    brand: da?.brand ?? '',
    componenti: da ? da.componenti.map((c) => ({ ...c })) : [{ tonalita: '', grammi: 0 }],
    ossigeno: da?.ossigeno ?? '',
    grammiOssigeno: da?.grammiOssigeno ?? 0,
    note: da?.note ?? '',
  };
}

/** Finestra per creare o modificare una scheda colore (data, brand, tonalità con grammi, ossigeno). */
export default function SchedaColoreEditor(p: { scheda: SchedaColore; titolo?: string; onChiudi: () => void }) {
  const [s, setS] = useState<SchedaColore>(p.scheda);
  const cambiaComp = (i: number, pezzo: Partial<SchedaColore['componenti'][number]>) =>
    setS({ ...s, componenti: s.componenti.map((c, j) => (j === i ? { ...c, ...pezzo } : c)) });

  async function salva() {
    await db.schede.put({ ...s, brand: s.brand.trim(), ossigeno: s.ossigeno.trim(), componenti: s.componenti.filter((c) => c.tonalita.trim()) });
    p.onChiudi();
  }
  async function elimina() {
    if (s.id && confirm('Eliminare questa scheda colore?')) {
      await db.schede.delete(s.id);
      p.onChiudi();
    }
  }

  return (
    <Modale
      titolo={p.titolo ?? (s.id ? 'Scheda colore' : 'Nuova scheda colore')}
      largo
      onChiudi={p.onChiudi}
      azioni={
        <>
          {s.id && (
            <button className="pericolo" onClick={elimina}>
              Elimina
            </button>
          )}
          <span className="totale-scheda">
            Totale colore + ossigeno <b>{grammiTotali(s)} g</b>
          </span>
          <span className="spazio" />
          <button className="primario" onClick={salva}>
            Salva
          </button>
        </>
      }
    >
      <div className="griglia-form due">
        <Campo etichetta="Data">
          <SceltaData valore={s.data} onChange={(d) => setS({ ...s, data: d })} label="Data della scheda" />
        </Campo>
        <Campo etichetta="Brand">
          <input value={s.brand} placeholder="es. Wella Koleston" onChange={(e) => setS({ ...s, brand: e.target.value })} />
        </Campo>
      </div>
      <h4>Tonalità</h4>
      {s.componenti.map((c, i) => (
        <div className="riga" key={i}>
          <input
            className="cresce"
            placeholder="Tonalità (es. 7/1)"
            aria-label={`Tonalità ${i + 1}`}
            value={c.tonalita}
            onChange={(e) => cambiaComp(i, { tonalita: e.target.value })}
          />
          <input
            className="stretto"
            inputMode="decimal"
            aria-label={`Grammi tonalità ${i + 1}`}
            value={c.grammi || ''}
            placeholder="0"
            onChange={(e) => cambiaComp(i, { grammi: num(e.target.value) })}
          />
          <span>g</span>
          <button className="icona" aria-label="Rimuovi tonalità" onClick={() => setS({ ...s, componenti: s.componenti.filter((_, j) => j !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <div className="riga subtotale">
        <button onClick={() => setS({ ...s, componenti: [...s.componenti, { tonalita: '', grammi: 0 }] })}>+ Tonalità</button>
        <span className="spazio" />
        Subtotale tonalità <b>{grammiTonalita(s)} g</b>
      </div>
      <h4>Ossigeno</h4>
      <div className="riga">
        <input className="cresce" placeholder="es. 20 vol / 6%" aria-label="Ossigeno" value={s.ossigeno} onChange={(e) => setS({ ...s, ossigeno: e.target.value })} />
        <input
          className="stretto"
          inputMode="decimal"
          aria-label="Grammi ossigeno"
          value={s.grammiOssigeno || ''}
          placeholder="0"
          onChange={(e) => setS({ ...s, grammiOssigeno: num(e.target.value) })}
        />
        <span>g</span>
      </div>
      <div className="riga subtotale">
        <span className="spazio" />
        Subtotale ossigeno <b>{s.grammiOssigeno || 0} g</b>
      </div>
      <Campo etichetta="Note (posa, zone, risultato…)">
        <textarea rows={2} value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} />
      </Campo>
    </Modale>
  );
}
