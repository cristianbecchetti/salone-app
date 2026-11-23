import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from '../db';
import type { Rotta } from '../App';
import type { Appuntamento, Cliente, SchedaColore } from '../types';
import {
  linkWhatsApp,
  normalizzaTelefono,
  parseFileContatti,
  rubricaDisponibile,
  scegliDallaRubrica,
  trovaDoppione,
  type Contatto,
} from '../lib/contatti';
import { dataNum, hm, oggi } from '../lib/tempo';
import { appuntamentiDelMese, grammiTotali, parametriMese, serviziDi, testoMese, testoRicetta } from '../lib/messaggi';
import { inviaWhatsApp, modoApi } from '../lib/whatsapp';
import SchedaColoreEditor, { nuovaScheda } from '../SchedaColoreEditor';
import { SceltaMese, Telefono } from '../scelte';
import { Campo, Modale, nomeCliente } from '../ui';

interface DaImportare extends Contatto {
  sel: boolean;
  doppio: boolean;
}
const VUOTO: Cliente = { nome: '', cognome: '', telefono: '', note: '' };

export default function Clienti({ vai }: { vai: (r: Rotta) => void }) {
  const imp = useImpostazioni();
  const clienti = useLiveQuery(() => db.clienti.toArray(), []) ?? [];
  const [cerca, setCerca] = useState('');
  const [scheda, setScheda] = useState<Cliente | null>(null);
  const [importa, setImporta] = useState<DaImportare[] | null>(null);
  const [msg, setMsg] = useState('');
  const [doppio, setDoppio] = useState<{ testo: string; cliente: Cliente } | null>(null);
  const [tab, setTab] = useState<'dati' | 'colori' | 'appuntamenti'>('dati');
  const [ricetta, setRicetta] = useState<SchedaColore | null>(null);
  const [mese, setMese] = useState(oggi().slice(0, 7));
  const schede =
    useLiveQuery(
      () => (scheda?.id ? db.schede.where('clientId').equals(scheda.id).toArray() : Promise.resolve([] as SchedaColore[])),
      [scheda?.id],
    )?.sort((a, b) => b.data.localeCompare(a.data) || (b.id ?? 0) - (a.id ?? 0)) ?? [];
  const file = useRef<HTMLInputElement>(null);
  const visite =
    useLiveQuery(
      () => (scheda?.id ? db.appuntamenti.where('clientId').equals(scheda.id).toArray() : Promise.resolve([] as Appuntamento[])),
      [scheda?.id],
    ) ?? [];

  const delMese = scheda?.id ? appuntamentiDelMese(visite, scheda.id, mese) : [];
  /** '' | 'invio' | 'inviato' | messaggio di errore */
  const [esitoMese, setEsitoMese] = useState('');
  async function inviaMese() {
    if (!scheda) return;
    setEsitoMese('invio');
    try {
      const ok = await inviaWhatsApp({
        imp,
        tipo: 'mese',
        numero: scheda.telefono,
        testo: testoMese(delMese, scheda, mese, imp),
        parametri: parametriMese(delMese, scheda, mese, imp),
        a: nomeCliente(scheda),
      });
      setEsitoMese(ok && modoApi(imp) ? 'inviato' : '');
    } catch (err) {
      setEsitoMese(err instanceof Error ? err.message : String(err));
    }
  }
  const apri = (c: Cliente) => {
    setDoppio(null);
    setTab('dati');
    setEsitoMese('');
    setScheda(c);
  };

  const q = cerca.trim().toLowerCase();
  const elenco = clienti
    .filter((c) => !q || `${c.nome} ${c.cognome} ${c.telefono}`.toLowerCase().includes(q))
    .sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b)));

  function anteprima(contatti: Contatto[]) {
    if (!contatti.length) {
      setMsg('Nessun contatto con nome e telefono trovato.');
      return;
    }
    const visti = new Set<string>();
    setMsg('');
    setImporta(
      contatti.map((c) => {
        const giaPresente = trovaDoppione(c, clienti, imp.prefisso);
        const doppio = visti.has(c.telefono) || (!!giaPresente && giaPresente.motivo !== 'omonimo');
        visti.add(c.telefono);
        return { ...c, doppio, sel: !doppio };
      }),
    );
  }

  async function daRubrica() {
    try {
      anteprima(await scegliDallaRubrica(imp.prefisso));
    } catch {
      setMsg('Non è stato possibile leggere la rubrica.');
    }
  }
  async function daFile(f?: File) {
    if (!f) return;
    anteprima(parseFileContatti(f.name, await f.text(), imp.prefisso));
    if (file.current) file.current.value = '';
  }
  async function confermaImporta() {
    const scelti = (importa ?? []).filter((c) => c.sel);
    await db.clienti.bulkAdd(scelti.map(({ nome, cognome, telefono }) => ({ nome, cognome, telefono, note: '' })));
    setImporta(null);
    setMsg(`${scelti.length} contatti importati.`);
  }

  async function salva() {
    if (!scheda || !(scheda.nome.trim() || scheda.cognome.trim())) return;
    // niente doppioni: stesso numero, o stesso nome senza numero → bloccato; omonimo con altro numero → conferma
    const d = trovaDoppione(scheda, clienti, imp.prefisso);
    if (d && d.motivo !== 'omonimo') {
      setDoppio({
        testo:
          d.motivo === 'telefono'
            ? `Questo numero è già di ${nomeCliente(d.cliente)}: il cliente è già in rubrica.`
            : `${nomeCliente(d.cliente)} è già in rubrica.`,
        cliente: d.cliente,
      });
      return;
    }
    if (
      d &&
      !confirm(
        `In rubrica c'è già ${nomeCliente(d.cliente)} con un altro numero (${d.cliente.telefono}).\nÈ un'altra persona con lo stesso nome? Salvare comunque?`,
      )
    )
      return;
    await db.clienti.put({
      ...scheda,
      nome: scheda.nome.trim(),
      cognome: scheda.cognome.trim(),
      telefono: normalizzaTelefono(scheda.telefono, imp.prefisso),
    });
    setScheda(null);
  }
  async function elimina() {
    if (!scheda?.id) return;
    const n = visite.length;
    if (!confirm(`Eliminare ${nomeCliente(scheda)}${n ? ` e i suoi ${n} appuntamenti` : ''}? L'operazione non si può annullare.`)) return;
    await db.transaction('rw', db.clienti, db.appuntamenti, async () => {
      await db.appuntamenti.where('clientId').equals(scheda.id!).delete();
      await db.clienti.delete(scheda.id!);
    });
    setScheda(null);
  }

  const selezionati = importa?.filter((c) => c.sel).length ?? 0;
  return (
    <div className="pagina">
      <header className="testata">
        <h1>Clienti</h1>
        <span className="tenue">{clienti.length}</span>
        <span className="spazio" />
        {rubricaDisponibile() && <button onClick={daRubrica}>Importa dalla rubrica</button>}
        <button onClick={() => file.current?.click()}>Importa file (vCard / CSV)</button>
        <input ref={file} type="file" accept=".vcf,.csv,text/vcard,text/csv" hidden onChange={(e) => daFile(e.target.files?.[0])} />
        <button className="primario" onClick={() => apri({ ...VUOTO })}>
          + Cliente
        </button>
      </header>
      {msg && <p className="nota">{msg}</p>}
      <input className="ricerca" placeholder="Cerca per nome o telefono…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
      <div className="elenco">
        {elenco.map((c) => (
          <button key={c.id} className="voce" onClick={() => apri(c)}>
            <strong>{nomeCliente(c)}</strong>
            {c.bloccato && <span className="etichetta bloccato">🚫 bloccato</span>}
            <span className="tenue">{c.telefono}</span>
          </button>
        ))}
        {!elenco.length && (
          <p className="tenue">
            {clienti.length ? 'Nessun cliente corrisponde alla ricerca.' : 'Rubrica vuota: aggiungi un cliente o importa i contatti.'}
          </p>
        )}
      </div>

      {scheda && (
        <Modale
          titolo={scheda.id ? nomeCliente(scheda) : 'Nuovo cliente'}
          onChiudi={() => setScheda(null)}
          azioni={
            <>
              {scheda.id && (
                <button className="pericolo" onClick={elimina}>
                  Elimina
                </button>
              )}
              <span className="spazio" />
              {scheda.id && scheda.telefono && (
                <a className="bottone" href={linkWhatsApp(scheda.telefono)} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              )}
              {scheda.id && <button onClick={() => vai({ p: 'prenota', pre: { clientId: scheda.id } })}>Prenota</button>}
              <button className="primario" onClick={salva}>
                Salva
              </button>
            </>
          }
        >
          {scheda.id && (
            <div className="segmenti schede-tab">
              {(
                [
                  ['dati', 'Dati'],
                  ['colori', `Schede colore (${schede.length})`],
                  ['appuntamenti', `Appuntamenti (${visite.length})`],
                ] as const
              ).map(([t, nome]) => (
                <button key={t} className={tab === t ? 'attivo' : ''} onClick={() => setTab(t)}>
                  {nome}
                </button>
              ))}
            </div>
          )}

          {doppio && (
            <div className="avviso riga a-capo">
              <span className="cresce">{doppio.testo}</span>
              <button className="piccolo" onClick={() => apri(doppio.cliente)}>
                Apri {nomeCliente(doppio.cliente)}
              </button>
            </div>
          )}
          {(tab === 'dati' || !scheda.id) && (
            <>
              <div className="griglia-form due">
                <Campo etichetta="Nome">
                  <input value={scheda.nome} onChange={(e) => setScheda({ ...scheda, nome: e.target.value })} />
                </Campo>
                <Campo etichetta="Cognome">
                  <input value={scheda.cognome} onChange={(e) => setScheda({ ...scheda, cognome: e.target.value })} />
                </Campo>
              </div>
              <Campo etichetta="Cellulare (WhatsApp)" nota="Scegli il paese: il numero viene salvato con il prefisso internazionale.">
                <Telefono valore={scheda.telefono} prefissoBase={imp.prefisso} label="cellulare" onChange={(t) => setScheda({ ...scheda, telefono: t })} />
              </Campo>
              <Campo etichetta="Note (preferenze, allergie…)">
                <textarea rows={3} value={scheda.note} onChange={(e) => setScheda({ ...scheda, note: e.target.value })} />
              </Campo>
              {scheda.bloccato ? (
                <div className="avviso stato-blocco">
                  <div className="riga a-capo">
                    <b className="cresce">
                      🚫 Cliente bloccato{scheda.bloccatoIl ? ` dal ${dataNum(scheda.bloccatoIl)}` : ''}
                    </b>
                    <button onClick={() => setScheda({ ...scheda, bloccato: false, motivoBlocco: undefined, bloccatoIl: undefined })}>Sblocca</button>
                  </div>
                  <input
                    placeholder="Motivo del blocco (es. non si presenta, debito…)"
                    value={scheda.motivoBlocco ?? ''}
                    onChange={(e) => setScheda({ ...scheda, motivoBlocco: e.target.value })}
                  />
                  <p className="tenue">Quando si crea un appuntamento per questo cliente compare un avviso. Premi Salva per confermare.</p>
                </div>
              ) : (
                <button className="blocca" onClick={() => setScheda({ ...scheda, bloccato: true, bloccatoIl: oggi(), motivoBlocco: '' })}>
                  🚫 Blocca cliente
                </button>
              )}
            </>
          )}

          {scheda.id && tab === 'colori' && (
            <>
              <div className="riga">
                <span className="tenue">Ricette colore eseguite, dalla più recente.</span>
                <span className="spazio" />
                <button className="primario" onClick={() => setRicetta(nuovaScheda(scheda.id!, oggi(), schede[0]))}>
                  + Nuova scheda
                </button>
              </div>
              {schede.map((r) => (
                <button key={r.id} className="voce alta" onClick={() => setRicetta(r)}>
                  <span>
                    <b>{dataNum(r.data)}</b> · {testoRicetta(r) || 'scheda vuota'}
                    {r.note && <span className="tenue"> — {r.note}</span>}
                  </span>
                  <span className="tenue">{grammiTotali(r)} g</span>
                </button>
              ))}
              {!schede.length && <p className="tenue">Nessuna scheda colore registrata.</p>}
              {schede.length > 0 && <p className="tenue">"Nuova scheda" parte da una copia dell'ultima ricetta, da ritoccare.</p>}
            </>
          )}

          {scheda.id && tab === 'appuntamenti' && (
            <>
              <section className="scheda">
                <h3>Invia gli appuntamenti del mese</h3>
                <div className="riga a-capo">
                  <SceltaMese
                    valore={mese}
                    onChange={(m) => {
                      setMese(m);
                      setEsitoMese('');
                    }}
                    label="Mese da inviare"
                  />
                  <span className="tenue">{delMese.length ? `${delMese.length} appuntamenti` : 'nessun appuntamento in questo mese'}</span>
                </div>
                {delMese.length > 0 && (
                  <>
                    <p className="anteprima">{testoMese(delMese, scheda, mese, imp)}</p>
                    {scheda.telefono ? (
                      <div className="riga a-capo">
                        <button className="bottone whatsapp" disabled={esitoMese === 'invio'} onClick={inviaMese}>
                          {esitoMese === 'invio' ? 'Invio…' : modoApi(imp) ? 'Invia ora' : 'Invia su WhatsApp'}
                        </button>
                        {esitoMese === 'inviato' && <span className="etichetta verde">✓ inviato</span>}
                        {esitoMese && esitoMese !== 'invio' && esitoMese !== 'inviato' && <p className="avviso">{esitoMese}</p>}
                      </div>
                    ) : (
                      <span className="etichetta gialla">manca il cellulare</span>
                    )}
                  </>
                )}
              </section>
              <h4>Storico appuntamenti</h4>
              {[...visite]
                .sort((a, b) => b.data.localeCompare(a.data) || b.inizio - a.inizio)
                .map((a) => (
                  <button key={a.id} className={`voce ${a.stato}`} onClick={() => vai({ p: 'prenota', id: a.id })}>
                    <span>
                      <b>{dataNum(a.data)}</b> {hm(a.inizio)} · {serviziDi(a)}
                    </span>
                    <span className="tenue">{a.stato}</span>
                  </button>
                ))}
              {!visite.length && <p className="tenue">Ancora nessun appuntamento.</p>}
            </>
          )}
        </Modale>
      )}

      {ricetta && <SchedaColoreEditor key={ricetta.id ?? 'nuova'} scheda={ricetta} onChiudi={() => setRicetta(null)} />}

      {importa && (
        <Modale
          titolo="Importa contatti"
          largo
          onChiudi={() => setImporta(null)}
          azioni={
            <>
              <button onClick={() => setImporta(importa.map((c) => ({ ...c, sel: !c.doppio })))}>Tutti</button>
              <button onClick={() => setImporta(importa.map((c) => ({ ...c, sel: false })))}>Nessuno</button>
              <span className="spazio" />
              <button className="primario" disabled={!selezionati} onClick={confermaImporta}>
                Importa {selezionati} contatti
              </button>
            </>
          }
        >
          <p className="tenue">Scegli chi aggiungere alla rubrica clienti. I numeri già presenti sono esclusi.</p>
          <div className="elenco">
            {importa.map((c, i) => (
              <label key={i} className={`voce spunta${c.doppio ? ' spento' : ''}`}>
                <input
                  type="checkbox"
                  checked={c.sel}
                  disabled={c.doppio}
                  onChange={(e) => setImporta(importa.map((x, j) => (j === i ? { ...x, sel: e.target.checked } : x)))}
                />
                <strong>{`${c.nome} ${c.cognome}`.trim()}</strong>
                <span className="spazio" />
                <span className="tenue">
                  {c.telefono}
                  {c.doppio ? ' · già presente' : ''}
                </span>
              </label>
            ))}
          </div>
        </Modale>
      )}
    </div>
  );
}
