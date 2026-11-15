import type { ReactNode } from 'react';
import type { Cliente, Fascia } from './types';
import { SceltaOra } from './scelte';

export const nomeCliente = (c?: Cliente) => (c ? `${c.nome} ${c.cognome}`.trim() : 'Cliente rimosso');

export function Modale(p: { titolo: string; onChiudi: () => void; children: ReactNode; azioni?: ReactNode; largo?: boolean }) {
  return (
    <div className="velo" onClick={p.onChiudi}>
      <div className={`modale${p.largo ? ' largo' : ''}`} role="dialog" aria-label={p.titolo} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{p.titolo}</h2>
          <button className="icona" onClick={p.onChiudi} aria-label="Chiudi">
            ✕
          </button>
        </header>
        <div className="corpo">{p.children}</div>
        {p.azioni && <footer>{p.azioni}</footer>}
      </div>
    </div>
  );
}

export function Campo(p: { etichetta: string; children: ReactNode; nota?: string }) {
  return (
    <label className="campo">
      <span>{p.etichetta}</span>
      {p.children}
      {p.nota && <small>{p.nota}</small>}
    </label>
  );
}

export function Ora(p: { valore: number; onChange: (m: number) => void; label?: string }) {
  return <SceltaOra valore={p.valore} onChange={p.onChange} label={p.label} passo={5} daOra={6} aOra={23} />;
}

/** Elenco modificabile di fasce orarie. Nessuna fascia = `vuoto` (es. "Chiuso"). */
export function FasceEditor(p: { fasce: Fascia[]; onChange: (f: Fascia[]) => void; vuoto?: string }) {
  const { fasce } = p;
  const cambia = (i: number, pezzo: Partial<Fascia>) => p.onChange(fasce.map((f, j) => (j === i ? { ...f, ...pezzo } : f)));
  const aggiungi = () => {
    const ultima = fasce[fasce.length - 1];
    p.onChange([...fasce, ultima ? { da: Math.min(ultima.a + 120, 22 * 60), a: Math.min(ultima.a + 360, 23 * 60) } : { da: 9 * 60, a: 13 * 60 }]);
  };
  return (
    <div className="fasce">
      {!fasce.length && <span className="tenue">{p.vuoto ?? 'Chiuso'}</span>}
      {fasce.map((f, i) => (
        <span className="fascia" key={i}>
          <Ora valore={f.da} onChange={(da) => cambia(i, { da })} label="Dalle" />
          <span>–</span>
          <Ora valore={f.a} onChange={(a) => cambia(i, { a })} label="Alle" />
          <button className="icona" aria-label="Rimuovi fascia" onClick={() => p.onChange(fasce.filter((_, j) => j !== i))}>
            ✕
          </button>
        </span>
      ))}
      <button className="piccolo" onClick={aggiungi}>
        + fascia
      </button>
    </div>
  );
}

export function Pallino({ colore }: { colore: string }) {
  return <span className="pallino" style={{ background: colore }} />;
}
