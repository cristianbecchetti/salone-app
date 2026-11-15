// Selettori grandi di data, ora e mese, pensati per il dito sul tablet.
// Sostituiscono i selettori del browser, che su Android sono piccoli e non ingrandibili.
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { aData, hm, iso, oggi, piuGiorni } from './lib/tempo';

const SETTIMANA = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

export const dataPulsante = (d: string) =>
  aData(d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Finestra di selezione a tutto schermo, sopra qualunque altra finestra. */
function Finestra(p: { titolo: string; onChiudi: () => void; children: ReactNode; piede?: ReactNode }) {
  return createPortal(
    <div className="velo velo-scelta" onClick={p.onChiudi}>
      <div className="modale scelta" role="dialog" aria-label={p.titolo} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{p.titolo}</h2>
          <button className="icona" onClick={p.onChiudi} aria-label="Chiudi">
            ✕
          </button>
        </header>
        <div className="corpo">{p.children}</div>
        {p.piede && <footer>{p.piede}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Scorrimento orizzontale del dito: verso sinistra = avanti, verso destra = indietro. */
function useSwipe(onSwipe: (verso: 1 | -1) => void) {
  const x0 = useRef<number | null>(null);
  return {
    onPointerDown: (e: PointerEvent) => (x0.current = e.clientX),
    onPointerUp: (e: PointerEvent) => {
      if (x0.current == null) return;
      const dx = e.clientX - x0.current;
      x0.current = null;
      if (Math.abs(dx) > 60) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

/** Calendario mensile con caselle grandi. `chiuso` marca (senza bloccare) i giorni di chiusura. */
export function Calendario(p: {
  valore: string;
  onScegli: (d: string) => void;
  min?: string;
  max?: string;
  chiuso?: (d: string) => boolean;
}) {
  const [mese, setMese] = useState(p.valore.slice(0, 7));
  const [anno, m] = mese.split('-').map(Number);
  const cambiaMese = (n: number) => {
    const d = new Date(anno, m - 1 + n, 1);
    setMese(iso(d).slice(0, 7));
  };
  const swipe = useSwipe(cambiaMese);
  const primo = new Date(anno, m - 1, 1);
  const inizio = piuGiorni(iso(primo), -((primo.getDay() + 6) % 7));
  const giorni = Array.from({ length: 42 }, (_, i) => piuGiorni(inizio, i));
  const oggiIso = oggi();

  return (
    <div className="calendario" {...swipe}>
      <div className="cal-testa">
        <button className="cal-freccia" onClick={() => cambiaMese(-1)} aria-label="Mese precedente">
          ‹
        </button>
        <strong>
          {MESI[m - 1]} {anno}
        </strong>
        <button className="cal-freccia" onClick={() => cambiaMese(1)} aria-label="Mese successivo">
          ›
        </button>
      </div>
      <div className="cal-griglia">
        {SETTIMANA.map((g) => (
          <span key={g} className="cal-sett">
            {g}
          </span>
        ))}
        {giorni.map((d) => {
          const fuori = !d.startsWith(mese);
          const vietato = (p.min && d < p.min) || (p.max && d > p.max);
          const cls = [
            'cal-giorno',
            fuori && 'fuori',
            d === oggiIso && 'oggi',
            d === p.valore && 'scelto',
            p.chiuso?.(d) && 'giorno-chiuso',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button key={d} className={cls} disabled={!!vietato} onClick={() => p.onScegli(d)} aria-label={aData(d).toLocaleDateString('it-IT', { dateStyle: 'full' })}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      {p.chiuso && <p className="tenue cal-legenda">I giorni a righe sono di chiusura: si possono comunque scegliere.</p>}
    </div>
  );
}

/** Pulsante che mostra la data e apre il calendario grande. */
export function SceltaData(p: {
  valore: string;
  onChange: (d: string) => void;
  label?: string;
  min?: string;
  max?: string;
  chiuso?: (d: string) => boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [aperto, setAperto] = useState(false);
  const scegli = (d: string) => {
    p.onChange(d);
    setAperto(false);
  };
  return (
    <>
      <button
        type="button"
        className={`scelta-campo ${p.className ?? ''}`}
        disabled={p.disabled}
        aria-label={p.label ? `${p.label}: ${dataPulsante(p.valore)}` : undefined}
        onClick={() => setAperto(true)}
      >
        <span aria-hidden>📅</span> {dataPulsante(p.valore)}
      </button>
      {aperto && (
        <Finestra
          titolo={p.label ?? 'Scegli la data'}
          onChiudi={() => setAperto(false)}
          piede={
            <>
              <button onClick={() => scegli(oggi())}>Oggi</button>
              <button onClick={() => scegli(piuGiorni(oggi(), 1))}>Domani</button>
              <button onClick={() => scegli(piuGiorni(p.valore, 7))}>+1 settimana</button>
              <span className="spazio" />
              <button onClick={() => setAperto(false)}>Annulla</button>
            </>
          }
        >
          <Calendario valore={p.valore} onScegli={scegli} min={p.min} max={p.max} chiuso={p.chiuso} />
        </Finestra>
      )}
    </>
  );
}

/** Pulsante che mostra l'ora e apre una griglia grande di ore e minuti. `valore` null = non scelta. */
export function SceltaOra(p: {
  valore: number | null;
  onChange: (m: number) => void;
  label?: string;
  passo?: number;
  daOra?: number;
  aOra?: number;
}) {
  const [aperto, setAperto] = useState(false);
  const [ora, setOra] = useState<number | null>(null);
  const passo = p.passo && 60 % p.passo === 0 && p.passo >= 5 ? p.passo : 5;
  const da = p.daOra ?? 7;
  const a = p.aOra ?? 22;
  const oraScelta = ora ?? (p.valore != null ? Math.floor(p.valore / 60) : null);
  const minuti = Array.from({ length: 60 / passo }, (_, i) => i * passo);
  const apri = () => {
    setOra(null);
    setAperto(true);
  };
  return (
    <>
      <button
        type="button"
        className="scelta-campo ora"
        aria-label={p.label ? `${p.label}: ${p.valore == null ? 'non scelta' : hm(p.valore)}` : undefined}
        onClick={apri}
      >
        <span aria-hidden>🕒</span> {p.valore == null ? '--:--' : hm(p.valore)}
      </button>
      {aperto && (
        <Finestra titolo={p.label ?? "Scegli l'ora"} onChiudi={() => setAperto(false)}>
          <h4>Ora</h4>
          <div className="griglia-ore">
            {Array.from({ length: a - da + 1 }, (_, i) => da + i).map((h) => (
              <button key={h} className={oraScelta === h ? 'scelto' : ''} onClick={() => setOra(h)}>
                {String(h).padStart(2, '0')}
              </button>
            ))}
          </div>
          <h4>Minuti {oraScelta == null && <span className="tenue">(prima scegli l'ora)</span>}</h4>
          <div className="griglia-ore minuti">
            {minuti.map((mm) => (
              <button
                key={mm}
                disabled={oraScelta == null}
                className={p.valore != null && ora == null && p.valore % 60 === mm ? 'scelto' : ''}
                onClick={() => {
                  p.onChange(oraScelta! * 60 + mm);
                  setAperto(false);
                }}
              >
                {oraScelta == null ? '--' : String(oraScelta).padStart(2, '0')}:{String(mm).padStart(2, '0')}
              </button>
            ))}
          </div>
        </Finestra>
      )}
    </>
  );
}

/** Pulsante che mostra il mese ('AAAA-MM') e apre la scelta tra i 12 mesi. */
export function SceltaMese(p: { valore: string; onChange: (m: string) => void; label?: string }) {
  const [aperto, setAperto] = useState(false);
  const [anno, setAnno] = useState(Number(p.valore.slice(0, 4)));
  const swipe = useSwipe((v) => setAnno(anno + v));
  return (
    <>
      <button
        type="button"
        className="scelta-campo"
        aria-label={p.label}
        onClick={() => {
          setAnno(Number(p.valore.slice(0, 4)));
          setAperto(true);
        }}
      >
        <span aria-hidden>📅</span> {MESI[Number(p.valore.slice(5, 7)) - 1]} {p.valore.slice(0, 4)}
      </button>
      {aperto && (
        <Finestra titolo={p.label ?? 'Scegli il mese'} onChiudi={() => setAperto(false)}>
          <div {...swipe}>
            <div className="cal-testa">
              <button className="cal-freccia" onClick={() => setAnno(anno - 1)} aria-label="Anno precedente">
                ‹
              </button>
              <strong>{anno}</strong>
              <button className="cal-freccia" onClick={() => setAnno(anno + 1)} aria-label="Anno successivo">
                ›
              </button>
            </div>
            <div className="griglia-mesi">
              {MESI.map((nome, i) => {
                const v = `${anno}-${String(i + 1).padStart(2, '0')}`;
                return (
                  <button
                    key={v}
                    className={v === p.valore ? 'scelto' : ''}
                    onClick={() => {
                      p.onChange(v);
                      setAperto(false);
                    }}
                  >
                    {nome}
                  </button>
                );
              })}
            </div>
          </div>
        </Finestra>
      )}
    </>
  );
}

/** Striscia scorrevole di giorni, per cambiare giorno con un tocco. */
export function StrisciaGiorni(p: { valore: string; onChange: (d: string) => void; da: string; giorni?: number; chiuso?: (d: string) => boolean }) {
  const n = p.giorni ?? 21;
  const oggiIso = oggi();
  const box = useRef<HTMLDivElement>(null);
  // porta in vista il giorno scelto, scorrendo solo la striscia (non la pagina)
  useEffect(() => {
    const b = box.current;
    const el = b?.querySelector<HTMLElement>('.giorno-chip.scelto');
    if (!b || !el) return;
    const rb = b.getBoundingClientRect();
    const re = el.getBoundingClientRect();
    b.scrollTo({ left: b.scrollLeft + re.left - rb.left - (rb.width - re.width) / 2, behavior: 'smooth' });
  }, [p.valore, p.da]);
  return (
    <div className="striscia" role="listbox" aria-label="Giorni" ref={box}>
      {Array.from({ length: n }, (_, i) => piuGiorni(p.da, i)).map((d) => {
        const data = aData(d);
        const cls = ['giorno-chip', d === p.valore && 'scelto', d === oggiIso && 'oggi', p.chiuso?.(d) && 'giorno-chiuso'].filter(Boolean).join(' ');
        return (
          <button
            key={d}
            role="option"
            aria-selected={d === p.valore}
            className={cls}
            onClick={() => p.onChange(d)}
          >
            <span>{data.toLocaleDateString('it-IT', { weekday: 'short' })}</span>
            <b>{data.getDate()}</b>
            <span>{data.toLocaleDateString('it-IT', { month: 'short' })}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Numero di minuti con pulsanti − / + grandi (passo 5). */
export function Minuti(p: { valore: number; onChange: (n: number) => void; label: string; passo?: number; min?: number }) {
  const passo = p.passo ?? 5;
  const minimo = p.min ?? 0;
  return (
    <span className="stepper" role="group" aria-label={p.label}>
      <button type="button" onClick={() => p.onChange(Math.max(minimo, p.valore - passo))} aria-label={`Riduci ${p.label}`}>
        −
      </button>
      <b>{p.valore}′</b>
      <button type="button" onClick={() => p.onChange(p.valore + passo)} aria-label={`Aumenta ${p.label}`}>
        +
      </button>
    </span>
  );
}
