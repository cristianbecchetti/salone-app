// Importa le schede colore cartacee dalle foto: una foto per scheda cartacea (una cliente),
// con dentro una o più ricette (una per data). Il testo è letto sul dispositivo; prima di salvare
// l'operatore controlla e corregge ogni ricetta. Si aggiungono solo schede nuove: le esistenti non cambiano.
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { Cliente, ComponenteColore } from './types';
import { erroreLettura, leggiTestoFoto, type Avanzamento } from './lib/ocr';
import { punteggio } from './lib/rubrica';
import { leggiSchede, type SchedaLetta } from './lib/schedeCarta';
import { dataNum, oggi } from './lib/tempo';
import { SceltaData } from './scelte';
import { Modale, nomeCliente } from './ui';

interface Ricetta extends SchedaLetta {
  scelta: boolean;
  /** sulla carta non c'era una data leggibile: proposta oggi, da controllare */
  senzaData: boolean;
}
interface Gruppo {
  url: string;
  testo: string;
  clientId?: number;
  riconosciuto: 'sicuro' | 'incerto' | 'nessuno' | 'fisso';
  ricette: Ricetta[];
}

const num = (v: string) => Math.max(0, Math.round(Number(v.replace(',', '.')) || 0));

/** Cliente più somigliante alle prime righe della scheda (di solito c'è scritto il nome). */
function trovaCliente(righe: string[], clienti: Cliente[]): { id?: number; esito: Gruppo['riconosciuto'] } {
  let best: { id: number; p: number } | undefined;
  for (const r of righe.slice(0, 4))
    for (const c of clienti) {
      const p = punteggio(r, c);
      if (p > 0 && (!best || p > best.p)) best = { id: c.id!, p };
    }
  return best ? { id: best.id, esito: best.p >= 0.75 ? 'sicuro' : 'incerto' } : { esito: 'nessuno' };
}

export default function SchedeFoto(p: { clienti: Cliente[]; clientId?: number; onChiudi: (esito?: string) => void }) {
  const [foto, setFoto] = useState<{ file: File; url: string }[]>([]);
  const [lettura, setLettura] = useState<Avanzamento | null>(null);
  const [gruppi, setGruppi] = useState<Gruppo[] | null>(null);
  const [errore, setErrore] = useState('');
  const [salvo, setSalvo] = useState(false);
  const esistenti = useLiveQuery(() => db.schede.toArray(), []) ?? [];
  const ordinati = useMemo(() => [...p.clienti].sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b))), [p.clienti]);
  const fisso = p.clienti.find((c) => c.id === p.clientId);

  const doppia = (clientId: number | undefined, data: string) => !!clientId && esistenti.some((s) => s.clientId === clientId && s.data === data);

  function scegliFoto(files: FileList | null) {
    if (!files?.length) return;
    setFoto([...foto, ...[...files].map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    setGruppi(null);
  }

  async function leggi() {
    setErrore('');
    setGruppi(null);
    setLettura({ pagina: 1, di: foto.length, perc: 0 });
    let testi: string[];
    try {
      testi = await leggiTestoFoto(
        foto.map((f) => f.file),
        setLettura,
      );
    } catch (e) {
      setLettura(null);
      setErrore(erroreLettura(e));
      return;
    }
    setLettura(null);
    const schedeEsistenti = await db.schede.toArray();
    setGruppi(
      testi.map((testo, i) => {
        const { intestazione, schede } = leggiSchede(testo, oggi());
        const cl = p.clientId
          ? { id: p.clientId, esito: 'fisso' as const }
          : trovaCliente(intestazione.length ? intestazione : testo.split('\n').filter((r) => r.trim()), p.clienti);
        return {
          url: foto[i].url,
          testo,
          clientId: cl.id,
          riconosciuto: cl.esito,
          ricette: schede.map((s) => {
            const data = s.data || oggi();
            const gia = !!cl.id && schedeEsistenti.some((x) => x.clientId === cl.id && x.data === data);
            return { ...s, data, senzaData: !s.data, scelta: s.componenti.length > 0 && !gia };
          }),
        };
      }),
    );
  }

  const cambiaGruppo = (g: number, pezzo: Partial<Gruppo>) => gruppi && setGruppi(gruppi.map((x, i) => (i === g ? { ...x, ...pezzo } : x)));
  const cambiaRicetta = (g: number, r: number, pezzo: Partial<Ricetta>) =>
    gruppi && cambiaGruppo(g, { ricette: gruppi[g].ricette.map((x, i) => (i === r ? { ...x, ...pezzo } : x)) });
  const cambiaComp = (g: number, r: number, c: number, pezzo: Partial<ComponenteColore>) =>
    gruppi && cambiaRicetta(g, r, { componenti: gruppi[g].ricette[r].componenti.map((x, i) => (i === c ? { ...x, ...pezzo } : x)) });

  const daSalvare = (gruppi ?? []).flatMap((g) => (g.clientId ? g.ricette.filter((r) => r.scelta).map((r) => ({ g, r })) : []));

  async function salva() {
    setSalvo(true);
    let n = 0;
    for (const { g, r } of daSalvare) {
      await db.schede.add({
        clientId: g.clientId!,
        data: r.data,
        brand: r.brand.trim(),
        componenti: r.componenti.filter((c) => c.tonalita.trim()).map((c) => ({ tonalita: c.tonalita.trim(), grammi: c.grammi })),
        ossigeno: r.ossigeno.trim(),
        grammiOssigeno: r.grammiOssigeno,
        note: r.note.trim(),
      });
      n++;
    }
    foto.forEach((f) => URL.revokeObjectURL(f.url));
    const clienti = new Set(daSalvare.map((x) => x.g.clientId)).size;
    p.onChiudi(`Schede colore cartacee: ${n} ${n === 1 ? 'scheda aggiunta' : 'schede aggiunte'} a ${clienti} ${clienti === 1 ? 'cliente' : 'clienti'}.`);
  }

  return (
    <Modale
      titolo={fisso ? `Schede colore cartacee di ${nomeCliente(fisso)}` : 'Schede colore cartacee'}
      largo
      onChiudi={() => p.onChiudi()}
      azioni={
        <>
          <button onClick={() => p.onChiudi()}>Annulla</button>
          <span className="spazio" />
          {gruppi && (
            <button className="primario" disabled={!daSalvare.length || salvo} onClick={salva}>
              {salvo ? 'Salvataggio…' : `Aggiungi ${daSalvare.length} ${daSalvare.length === 1 ? 'scheda' : 'schede'}`}
            </button>
          )}
        </>
      }
    >
      <p className="tenue">
        {fisso
          ? 'Fotografa la scheda cartacea di questa cliente (anche più facciate): '
          : 'Fotografa le schede cartacee, una foto per cliente: il nome scritto in alto serve a riconoscere la cliente. '}
        ogni data diventa una ricetta con tonalità, grammi, ossigeno e brand. Controlli e correggi tutto prima di salvare; le schede già
        presenti non vengono toccate. Le foto restano su questo dispositivo.
      </p>

      <div className="riga a-capo">
        <label className="bottone">
          📷 {foto.length ? 'Aggiungi foto' : 'Fotografa o scegli le schede'}
          <input type="file" accept="image/*" multiple hidden onChange={(e) => scegliFoto(e.target.files)} />
        </label>
        {foto.length > 0 && <span className="tenue">{foto.length === 1 ? '1 foto' : `${foto.length} foto`}</span>}
        <span className="spazio" />
        {foto.length > 0 && (
          <button className="primario" disabled={!!lettura} onClick={leggi}>
            {gruppi ? 'Rileggi' : 'Leggi le schede'}
          </button>
        )}
      </div>
      {!gruppi && foto.length > 0 && (
        <div className="rubrica-anteprime">
          {foto.map((f, i) => (
            <a key={f.url} href={f.url} target="_blank" rel="noreferrer" title="Apri la foto">
              <img src={f.url} alt={`Foto ${i + 1}`} />
            </a>
          ))}
        </div>
      )}
      <p className="tenue">Consigli: foto dritta e ben illuminata, una scheda per foto, inquadrata da vicino. Lo stampatello si legge meglio del corsivo.</p>
      {lettura && (
        <p className="nota">
          Lettura foto {lettura.pagina} di {lettura.di}… {lettura.perc}%
        </p>
      )}
      {errore && <p className="avviso">{errore}</p>}

      {gruppi?.map((g, gi) => (
        <section className="scheda gruppo-foto" key={g.url}>
          <div className="riga a-capo">
            <a href={g.url} target="_blank" rel="noreferrer" title="Apri la foto">
              <img className="miniatura-foto" src={g.url} alt={`Foto ${gi + 1}`} />
            </a>
            <div className="cresce">
              <b>Foto {gi + 1}</b>
              {g.riconosciuto !== 'fisso' && (
                <div className="riga a-capo">
                  <select
                    value={g.clientId ?? ''}
                    aria-label="Cliente della scheda"
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : undefined;
                      cambiaGruppo(gi, {
                        clientId: id,
                        riconosciuto: 'sicuro',
                        ricette: g.ricette.map((r) => ({ ...r, scelta: r.componenti.length > 0 && !doppia(id, r.data) })),
                      });
                    }}
                  >
                    <option value="">— scegli la cliente —</option>
                    {ordinati.map((c) => (
                      <option key={c.id} value={c.id}>
                        {nomeCliente(c)}
                      </option>
                    ))}
                  </select>
                  {g.riconosciuto === 'incerto' && <span className="etichetta gialla">cliente da controllare</span>}
                  {!g.clientId && <span className="etichetta gialla">cliente non riconosciuta: sceglila</span>}
                </div>
              )}
              <details>
                <summary className="tenue">Testo letto</summary>
                <pre className="testo-letto">{g.testo}</pre>
              </details>
            </div>
          </div>
          {!g.ricette.length && <p className="avviso">Nessuna ricetta riconosciuta in questa foto: prova con una foto più nitida o aggiungila a mano.</p>}
          {g.ricette.map((r, ri) => {
            const gia = doppia(g.clientId, r.data);
            return (
              <div className={`ricetta-letta${r.scelta ? ' scelta' : ''}`} key={ri}>
                <div className="riga a-capo">
                  <label className="spunta">
                    <input type="checkbox" checked={r.scelta} onChange={(e) => cambiaRicetta(gi, ri, { scelta: e.target.checked })} />
                    Importa
                  </label>
                  <SceltaData valore={r.data} label="Data della ricetta" onChange={(d) => cambiaRicetta(gi, ri, { data: d, senzaData: false })} />
                  <input className="cresce" placeholder="Brand" value={r.brand} onChange={(e) => cambiaRicetta(gi, ri, { brand: e.target.value })} />
                  {r.senzaData && <span className="etichetta gialla">data non letta: controlla</span>}
                  {gia && <span className="etichetta gialla">c'è già una scheda del {dataNum(r.data)}</span>}
                </div>
                {r.componenti.map((c, ci) => (
                  <div className="riga" key={ci}>
                    <input
                      className="cresce"
                      placeholder="Tonalità (es. 7/1)"
                      aria-label={`Tonalità ${ci + 1}`}
                      value={c.tonalita}
                      onChange={(e) => cambiaComp(gi, ri, ci, { tonalita: e.target.value })}
                    />
                    <input
                      className="grammi"
                      inputMode="numeric"
                      aria-label={`Grammi tonalità ${ci + 1}`}
                      value={c.grammi || ''}
                      placeholder="g"
                      onChange={(e) => cambiaComp(gi, ri, ci, { grammi: num(e.target.value) })}
                    />
                    <span className="tenue">g</span>
                    <button
                      className="icona"
                      aria-label="Togli tonalità"
                      onClick={() => cambiaRicetta(gi, ri, { componenti: r.componenti.filter((_, j) => j !== ci) })}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="riga a-capo">
                  <button className="piccolo" onClick={() => cambiaRicetta(gi, ri, { componenti: [...r.componenti, { tonalita: '', grammi: 0 }] })}>
                    + Tonalità
                  </button>
                  <span>Ossigeno</span>
                  <input className="ossigeno" placeholder="es. 20 vol" value={r.ossigeno} onChange={(e) => cambiaRicetta(gi, ri, { ossigeno: e.target.value })} />
                  <input
                    className="grammi"
                    inputMode="numeric"
                    aria-label="Grammi ossigeno"
                    placeholder="g"
                    value={r.grammiOssigeno || ''}
                    onChange={(e) => cambiaRicetta(gi, ri, { grammiOssigeno: num(e.target.value) })}
                  />
                  <span className="tenue">g</span>
                </div>
                <input placeholder="Note" value={r.note} onChange={(e) => cambiaRicetta(gi, ri, { note: e.target.value })} />
                <p className="tenue sulla-carta">Sulla carta: {r.righe.join(' · ') || '—'}</p>
              </div>
            );
          })}
          <button
            className="piccolo"
            onClick={() =>
              cambiaGruppo(gi, {
                ricette: [
                  ...g.ricette,
                  { data: oggi(), senzaData: true, brand: '', componenti: [{ tonalita: '', grammi: 0 }], ossigeno: '', grammiOssigeno: 0, note: '', righe: [], scelta: true },
                ],
              })
            }
          >
            + Ricetta a mano
          </button>
        </section>
      ))}
    </Modale>
  );
}
