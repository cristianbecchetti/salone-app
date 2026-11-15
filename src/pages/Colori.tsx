import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from '../db';
import type { Appuntamento, SchedaColore, Servizio } from '../types';
import { linkWhatsApp } from '../lib/contatti';
import { grammiTotali, ricettaPer, serviziDi, testoPreparazione, testoRicetta, type VocePreparazione } from '../lib/messaggi';
import { dataLunga, dataNum, hm, oggi, piuGiorni } from '../lib/tempo';
import SchedaColoreEditor, { nuovaScheda } from '../SchedaColoreEditor';
import { Pallino, nomeCliente } from '../ui';
import { SceltaData } from '../scelte';

/** La fase da cui serve il colore: la prima fase di un servizio con preparazione. */
function faseColore(a: Appuntamento, servizi: Servizio[]) {
  const conColore = (serviceId: number, competenza?: string) => {
    const s = servizi.find((x) => x.id === serviceId);
    return s ? !!s.preparazione : /colore|schiarit/i.test(competenza ?? '');
  };
  return a.fasi.find((f) => conColore(f.serviceId, f.competenza));
}

/**
 * Preparazione colori del giorno: per ogni appuntamento con un servizio di colore,
 * la ricetta da preparare (quella dell'appuntamento o l'ultima del cliente) e lo storico.
 * Con `magazzino` è la vista a schermo intero aperta da …/#magazzino.
 */
export default function Colori({ magazzino = false }: { magazzino?: boolean }) {
  const imp = useImpostazioni();
  const [giorno, setGiorno] = useState(oggi());
  const [modifica, setModifica] = useState<SchedaColore | null>(null);
  const servizi = useLiveQuery(() => db.servizi.toArray(), []) ?? [];
  const clienti = useLiveQuery(() => db.clienti.toArray(), []) ?? [];
  const operatori = useLiveQuery(() => db.operatori.toArray(), []) ?? [];
  const delGiorno = useLiveQuery(() => db.appuntamenti.where('data').equals(giorno).toArray(), [giorno]) ?? [];
  const idClienti = [...new Set(delGiorno.map((a) => a.clientId))];
  const schede = useLiveQuery(() => db.schede.where('clientId').anyOf(idClienti).toArray(), [idClienti.join(',')]) ?? [];

  const voci = delGiorno
    .filter((a) => a.stato === 'prenotato' || a.stato === 'completato')
    .flatMap((a) => {
      const f = faseColore(a, servizi);
      if (!f) return [];
      const { scheda, propria } = ricettaPer(a, schede);
      return [{ a, cliente: clienti.find((c) => c.id === a.clientId), ora: f.inizio, staffId: f.staffId, scheda, propria }];
    })
    .sort((x, y) => x.ora - y.ora);
  const daFare = voci.filter((v) => !v.a.preparatoIl).length;
  const testo = testoPreparazione(giorno, voci as VocePreparazione[]);

  const segna = (a: Appuntamento, fatto: boolean) =>
    db.appuntamenti.update(a.id!, { preparatoIl: fatto ? new Date().toISOString() : undefined });

  return (
    <div className={`pagina colori${magazzino ? ' magazzino' : ''}`}>
      <header className="testata">
        <h1>Preparazione colori</h1>
        <span className="spazio" />
        <button className="no-stampa" onClick={() => setGiorno(piuGiorni(giorno, -1))} aria-label="Giorno precedente">
          ‹
        </button>
        <button className="no-stampa" onClick={() => setGiorno(oggi())}>
          Oggi
        </button>
        <button className="no-stampa" onClick={() => setGiorno(piuGiorni(giorno, 1))} aria-label="Giorno successivo">
          ›
        </button>
        <SceltaData className="no-stampa" valore={giorno} onChange={setGiorno} label="Giorno" />
        <button className="no-stampa" onClick={() => window.print()}>
          Stampa
        </button>
        <a className="bottone whatsapp no-stampa" href={linkWhatsApp(imp.numeroMagazzino ?? '', testo)} target="_blank" rel="noreferrer">
          Invia al magazzino
        </a>
      </header>
      <p className="nota">
        <b className="capitalizza">{dataLunga(giorno)}</b>:{' '}
        {voci.length ? `${voci.length} ${voci.length === 1 ? 'colore' : 'colori'}, ${daFare} da preparare.` : 'nessun colore in agenda.'}
        {!magazzino && !imp.numeroMagazzino && (
          <span className="no-stampa"> Il numero WhatsApp del magazzino si imposta in Altro; senza numero WhatsApp chiede a chi inviare.</span>
        )}
      </p>

      <div className="elenco">
        {voci.map((v) => {
          const op = operatori.find((o) => o.id === v.staffId);
          const storico = schede
            .filter((s) => s.clientId === v.a.clientId && s.id !== v.scheda?.id)
            .sort((x, y) => y.data.localeCompare(x.data))
            .slice(0, 5);
          return (
            <section key={v.a.id} className={`scheda prep${v.a.preparatoIl ? ' fatto' : ''}`}>
              <div className="riga a-capo">
                <b className="ora-grande">{hm(v.ora)}</b>
                <div className="cresce">
                  <strong>{nomeCliente(v.cliente)}</strong>
                  <div className="tenue">
                    {serviziDi(v.a)}
                    {op && (
                      <>
                        {' · '}
                        <Pallino colore={op.colore} /> {op.nome}
                      </>
                    )}
                  </div>
                </div>
                <label className="spunta prep-check">
                  <input type="checkbox" checked={!!v.a.preparatoIl} onChange={(e) => segna(v.a, e.target.checked)} />
                  Preparato
                </label>
              </div>

              {v.scheda ? (
                <>
                  <div className="tenue">
                    {v.propria ? 'Ricetta per questo appuntamento' : `Ricetta dell'ultima volta (${dataNum(v.scheda.data)})`}
                  </div>
                  <table className="ricetta">
                    <tbody>
                      {v.scheda.brand && (
                        <tr>
                          <td colSpan={2}>
                            <b>{v.scheda.brand}</b>
                          </td>
                        </tr>
                      )}
                      {v.scheda.componenti.map((c, i) => (
                        <tr key={i}>
                          <td>{c.tonalita}</td>
                          <td className="grammi">{c.grammi} g</td>
                        </tr>
                      ))}
                      {v.scheda.ossigeno && (
                        <tr>
                          <td>Ossigeno {v.scheda.ossigeno}</td>
                          <td className="grammi">{v.scheda.grammiOssigeno} g</td>
                        </tr>
                      )}
                      <tr className="totale">
                        <td>Totale</td>
                        <td className="grammi">{grammiTotali(v.scheda)} g</td>
                      </tr>
                    </tbody>
                  </table>
                  {v.scheda.note && <p className="nota">{v.scheda.note}</p>}
                </>
              ) : (
                <p className="avviso">Nessuna ricetta registrata per questo cliente.</p>
              )}

              <div className="riga a-capo no-stampa">
                <button
                  onClick={() =>
                    setModifica(v.propria && v.scheda ? v.scheda : nuovaScheda(v.a.clientId, v.a.data, v.scheda, v.a.id))
                  }
                >
                  {v.propria ? 'Modifica ricetta' : v.scheda ? 'Ritocca per questo appuntamento' : 'Scrivi ricetta'}
                </button>
              </div>

              {storico.length > 0 && (
                <details className="no-stampa">
                  <summary>Schede precedenti ({storico.length})</summary>
                  {storico.map((s) => (
                    <div key={s.id} className="riga">
                      <b>{dataNum(s.data)}</b> <span>{testoRicetta(s)}</span>
                      {s.note && <span className="tenue"> — {s.note}</span>}
                    </div>
                  ))}
                </details>
              )}
            </section>
          );
        })}
      </div>

      {modifica && (
        <SchedaColoreEditor
          key={modifica.id ?? 'nuova'}
          scheda={modifica}
          titolo={`Ricetta per ${nomeCliente(clienti.find((c) => c.id === modifica.clientId))}`}
          onChiudi={() => setModifica(null)}
        />
      )}
    </div>
  );
}
