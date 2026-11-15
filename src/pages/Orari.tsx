import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from '../db';
import type { Eccezione, Fascia } from '../types';
import { GIORNI, ORDINE_GIORNI, dataLunga, hm, oggi } from '../lib/tempo';
import { Campo, FasceEditor, Modale } from '../ui';
import { SceltaData } from '../scelte';

export default function Orari() {
  const imp = useImpostazioni();
  const eccezioni = useLiveQuery(() => db.eccezioni.orderBy('data').toArray(), []) ?? [];
  const [e, setE] = useState<(Eccezione & { nuova?: boolean }) | null>(null);
  const [passate, setPassate] = useState(false);

  const setGiorno = (g: number, fasce: Fascia[]) =>
    db.impostazioni.put({ ...imp, settimana: imp.settimana.map((x, i) => (i === g ? fasce : x)) });

  async function salva() {
    if (!e || !e.data) return;
    await db.eccezioni.put({ data: e.data, fasce: e.fasce, nota: e.nota.trim() });
    setE(null);
  }

  const elenco = eccezioni.filter((x) => passate || x.data >= oggi());
  return (
    <div className="pagina">
      <header className="testata">
        <h1>Orari di apertura</h1>
      </header>

      <section className="scheda">
        <h3>Settimana tipo</h3>
        <p className="tenue">Le modifiche si salvano subito. Un giorno senza fasce è chiuso.</p>
        {ORDINE_GIORNI.map((g) => (
          <div className="riga a-capo giorno-riga" key={g}>
            <strong className="giorno-nome">{GIORNI[g]}</strong>
            <FasceEditor fasce={imp.settimana[g] ?? []} onChange={(f) => setGiorno(g, f)} />
          </div>
        ))}
      </section>

      <section className="scheda">
        <div className="riga">
          <h3>Chiusure e aperture straordinarie</h3>
          <span className="spazio" />
          <button className="primario" onClick={() => setE({ data: oggi(), fasce: [], nota: '', nuova: true })}>
            + Data
          </button>
        </div>
        <p className="tenue">Festivi, ferie del salone, aperture di domenica, orari ridotti: valgono solo per quella data.</p>
        <div className="elenco">
          {elenco.map((x) => (
            <button key={x.data} className={`voce${x.data < oggi() ? ' spento' : ''}`} onClick={() => setE(x)}>
              <span>
                <strong className="capitalizza">{dataLunga(x.data)}</strong> {x.data.slice(0, 4)}
                {x.nota && <span className="tenue"> · {x.nota}</span>}
              </span>
              <span className={`etichetta ${x.fasce.length ? '' : 'gialla'}`}>
                {x.fasce.length ? x.fasce.map((f) => `${hm(f.da)}–${hm(f.a)}`).join(' · ') : 'Chiuso'}
              </span>
            </button>
          ))}
          {!elenco.length && <p className="tenue">Nessuna data particolare in programma.</p>}
        </div>
        {eccezioni.some((x) => x.data < oggi()) && (
          <label className="spunta">
            <input type="checkbox" checked={passate} onChange={(ev) => setPassate(ev.target.checked)} />
            mostra anche le date passate
          </label>
        )}
      </section>

      {e && (
        <Modale
          titolo={e.nuova ? 'Nuova data particolare' : 'Modifica data'}
          onChiudi={() => setE(null)}
          azioni={
            <>
              {!e.nuova && (
                <button
                  className="pericolo"
                  onClick={async () => {
                    await db.eccezioni.delete(e.data);
                    setE(null);
                  }}
                >
                  Rimuovi (torna all'orario normale)
                </button>
              )}
              <span className="spazio" />
              <button className="primario" onClick={salva}>
                Salva
              </button>
            </>
          }
        >
          <Campo etichetta="Data">
            <SceltaData valore={e.data} disabled={!e.nuova} onChange={(d) => setE({ ...e, data: d })} label="Data particolare" />
          </Campo>
          <Campo etichetta="Motivo (facoltativo)">
            <input value={e.nota} placeholder="es. Festivo, ferie, apertura straordinaria" onChange={(ev) => setE({ ...e, nota: ev.target.value })} />
          </Campo>
          <h4>Orario di quel giorno</h4>
          <FasceEditor fasce={e.fasce} onChange={(fasce) => setE({ ...e, fasce })} vuoto="Chiuso tutto il giorno" />
        </Modale>
      )}
    </div>
  );
}
