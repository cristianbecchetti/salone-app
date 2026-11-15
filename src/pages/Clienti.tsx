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
  type Contatto,
} from '../lib/contatti';
import { dataNum, hm, oggi } from '../lib/tempo';
import { appuntamentiDelMese, grammiTotali, serviziDi, testoMese, testoRicetta } from '../lib/messaggi';
import SchedaColoreEditor, { nuovaScheda } from '../SchedaColoreEditor';
import { SceltaMese } from '../scelte';
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
  const apri = (c: Cliente) => {
    setTab('dati');
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
    const esistenti = new Set(clienti.map((c) => c.telefono));
    const visti = new Set<string>();
    setMsg('');
    setImporta(
      contatti.map((c) => {
        const doppio = esistenti.has(c.telefono) || visti.has(c.telefono);
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
              <Campo etichetta="Cellulare (WhatsApp)" nota={`Senza prefisso viene aggiunto ${imp.prefisso}`}>
                <input inputMode="tel" value={scheda.telefono} onChange={(e) => setScheda({ ...scheda, telefono: e.target.value })} />
              </Campo>
              <Campo etichetta="Note (preferenze, allergie…)">
                <textarea rows={3} value={scheda.note} onChange={(e) => setScheda({ ...scheda, note: e.target.value })} />
              </Campo>
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
                  <SceltaMese valore={mese} onChange={setMese} label="Mese da inviare" />
                  <span className="tenue">{delMese.length ? `${delMese.length} appuntamenti` : 'nessun appuntamento in questo mese'}</span>
                </div>
                {delMese.length > 0 && (
                  <>
                    <p className="anteprima">{testoMese(delMese, scheda, mese, imp)}</p>
                    {scheda.telefono ? (
                      <a
                        className="bottone whatsapp"
                        href={linkWhatsApp(scheda.telefono, testoMese(delMese, scheda, mese, imp))}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Invia su WhatsApp
                      </a>
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
