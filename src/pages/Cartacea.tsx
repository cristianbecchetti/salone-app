// Confronto con l'agenda cartacea: foto della pagina del giorno accanto agli appuntamenti dell'app.
// Si spunta ogni appuntamento ("c'è sulla carta" / "non c'è") e si aggiungono quelli scritti solo sulla carta.
// La foto resta solo in memoria su questo dispositivo; le spunte sono salvate solo in questo browser.
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Rotta } from '../App';
import type { Appuntamento } from '../types';
import { serviziDi } from '../lib/messaggi';
import { dataLunga, hm, oggi, piuGiorni } from '../lib/tempo';
import { SceltaData } from '../scelte';
import { nomeCliente, Pallino } from '../ui';

type Esito = 'si' | 'no';

// foto per giorno, tenute finché l'app resta aperta (anche cambiando pagina)
const foto = new Map<string, string>();
const chiave = (g: string) => `confronto-carta-${g}`;
const leggiSpunte = (g: string): Record<number, Esito> => {
  try {
    return JSON.parse(localStorage.getItem(chiave(g)) ?? '{}');
  } catch {
    return {};
  }
};

export default function Cartacea({ vai, giornoIniziale }: { vai: (r: Rotta) => void; giornoIniziale: string }) {
  const [giorno, setGiorno] = useState(giornoIniziale);
  const [immagine, setImmagine] = useState<string | undefined>(foto.get(giornoIniziale));
  const [zoom, setZoom] = useState(100);
  const [spunte, setSpunte] = useState<Record<number, Esito>>(() => leggiSpunte(giornoIniziale));
  const clienti = useLiveQuery(() => db.clienti.toArray(), []) ?? [];
  const operatori = useLiveQuery(() => db.operatori.toArray(), []) ?? [];
  const lista = (useLiveQuery(() => db.appuntamenti.where('data').equals(giorno).toArray(), [giorno]) ?? [])
    .filter((a) => a.stato !== 'annullato')
    .sort((a, b) => a.inizio - b.inizio);

  useEffect(() => {
    setImmagine(foto.get(giorno));
    setSpunte(leggiSpunte(giorno));
    setZoom(100);
  }, [giorno]);

  function segna(a: Appuntamento, e: Esito) {
    const nuove = { ...spunte };
    if (nuove[a.id!] === e) delete nuove[a.id!];
    else nuove[a.id!] = e;
    setSpunte(nuove);
    try {
      localStorage.setItem(chiave(giorno), JSON.stringify(nuove));
    } catch {
      /* spunte non salvate: restano finché la pagina è aperta */
    }
  }

  function caricaFoto(f?: File) {
    if (!f) return;
    const vecchia = foto.get(giorno);
    if (vecchia) URL.revokeObjectURL(vecchia);
    const url = URL.createObjectURL(f);
    foto.set(giorno, url);
    setImmagine(url);
    setZoom(100);
  }

  const verificati = lista.filter((a) => spunte[a.id!] === 'si').length;
  const mancano = lista.filter((a) => spunte[a.id!] === 'no').length;
  const daFare = lista.length - verificati - mancano;
  const operatoriDi = (a: Appuntamento) =>
    [...new Set(a.fasi.filter((f) => f.tipo === 'lavoro').map((f) => f.staffId))]
      .map((id) => operatori.find((o) => o.id === id))
      .filter(Boolean);

  return (
    <div className="pagina cartacea">
      <header className="testata">
        <h1>Confronto con l’agenda cartacea</h1>
        <span className="spazio" />
        <button onClick={() => setGiorno(piuGiorni(giorno, -1))} aria-label="Giorno precedente">
          ‹
        </button>
        <SceltaData valore={giorno} onChange={setGiorno} label="Giorno da confrontare" />
        <button onClick={() => setGiorno(piuGiorni(giorno, 1))} aria-label="Giorno successivo">
          ›
        </button>
        {giorno !== oggi() && <button onClick={() => setGiorno(oggi())}>Oggi</button>}
      </header>

      <p className={mancano ? 'avviso' : 'nota'}>
        <b className="capitalizza">{dataLunga(giorno)}</b>: {lista.length} appuntamenti nell’app · ✓ {verificati} sulla carta · ✗ {mancano}{' '}
        non sulla carta · {daFare} da controllare.
        {mancano > 0 && ' Apri quelli con ✗ per correggerli o annullarli.'}
      </p>

      <div className="due-colonne">
        <section className="scheda foto-carta">
          <div className="riga a-capo">
            <h3>Pagina cartacea</h3>
            <span className="spazio" />
            <label className="bottone primario">
              📷 {immagine ? 'Nuova foto' : 'Fotografa la pagina'}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => caricaFoto(e.target.files?.[0])} />
            </label>
            {immagine && (
              <>
                <button className="piccolo" onClick={() => setZoom(Math.max(50, zoom - 25))} aria-label="Rimpicciolisci">
                  −
                </button>
                <span className="tenue">{zoom}%</span>
                <button className="piccolo" onClick={() => setZoom(Math.min(400, zoom + 25))} aria-label="Ingrandisci">
                  +
                </button>
              </>
            )}
          </div>
          {immagine ? (
            <div className="foto-scorri">
              <img src={immagine} alt={`Agenda cartacea del ${dataLunga(giorno)}`} style={{ width: `${zoom}%` }} />
            </div>
          ) : (
            <p className="tenue">
              Fotografa la pagina dell’agenda di questo giorno (o scegli una foto già fatta): comparirà qui, accanto agli appuntamenti dell’app.
              La foto resta solo su questo dispositivo e non viene salvata.
            </p>
          )}
        </section>

        <section className="scheda">
          <div className="riga a-capo">
            <h3>Appuntamenti nell’app</h3>
            <span className="spazio" />
            <button className="primario piccolo" onClick={() => vai({ p: 'prenota', pre: { data: giorno }, da: 'cartacea' })}>
              + Aggiungi appuntamento mancante
            </button>
          </div>
          <p className="tenue">Per ogni appuntamento: ✓ se è anche sulla carta, ✗ se sulla carta non c’è. Quelli scritti solo sulla carta aggiungili con il pulsante qui sopra.</p>
          {lista.map((a) => {
            const e = spunte[a.id!];
            return (
              <div key={a.id} className={`riga-confronto${e === 'si' ? ' ok' : e === 'no' ? ' manca' : ''}`}>
                <button className="voce" onClick={() => vai({ p: 'prenota', id: a.id, da: 'cartacea' })}>
                  <span>
                    <b>{hm(a.inizio)}</b> {nomeCliente(clienti.find((c) => c.id === a.clientId))}
                    <span className="tenue"> · {serviziDi(a)}</span>
                    {operatoriDi(a).map((o) => (
                      <span key={o!.id} className="tenue">
                        {' '}
                        · <Pallino colore={o!.colore} /> {o!.nome}
                      </span>
                    ))}
                  </span>
                </button>
                <div className="segni">
                  <button className={`segno si${e === 'si' ? ' scelto' : ''}`} aria-pressed={e === 'si'} aria-label="C'è sulla carta" onClick={() => segna(a, 'si')}>
                    ✓
                  </button>
                  <button className={`segno no${e === 'no' ? ' scelto' : ''}`} aria-pressed={e === 'no'} aria-label="Non c'è sulla carta" onClick={() => segna(a, 'no')}>
                    ✗
                  </button>
                </div>
              </div>
            );
          })}
          {!lista.length && <p className="tenue">Nessun appuntamento nell’app per questo giorno.</p>}
        </section>
      </div>
    </div>
  );
}
