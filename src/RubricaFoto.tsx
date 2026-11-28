// Aggiorna in blocco i telefoni mancanti leggendo le foto della rubrica cartacea.
// Il testo viene letto sul dispositivo (Tesseract); prima di salvare l'operatore controlla ogni riga.
// Si scrive solo il telefono e solo sui clienti che non ne hanno uno.
import { useMemo, useState } from 'react';
import { db } from './db';
import type { Cliente } from './types';
import { normalizzaTelefono } from './lib/contatti';
import { erroreLettura, leggiTestoFoto } from './lib/ocr';
import { estraiVoci, numeroPlausibile, proponi, type Proposta } from './lib/rubrica';
import { Modale, nomeCliente } from './ui';

interface Riga extends Proposta {
  scelto: boolean;
  numeroScritto: string;
}

export default function RubricaFoto(p: { clienti: Cliente[]; prefisso: string; onChiudi: (esito?: string) => void }) {
  const [foto, setFoto] = useState<File[]>([]);
  const [anteprime, setAnteprime] = useState<string[]>([]);
  const [lettura, setLettura] = useState<{ pagina: number; di: number; perc: number } | null>(null);
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [errore, setErrore] = useState('');
  const [soloAbbinate, setSoloAbbinate] = useState(true);
  const [salvo, setSalvo] = useState(false);

  const senzaNumero = useMemo(
    () => p.clienti.filter((c) => !c.telefono?.trim()).sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b))),
    [p.clienti],
  );

  function scegliFoto(files: FileList | null) {
    if (!files?.length) return;
    const nuove = [...files];
    setFoto([...foto, ...nuove]);
    setAnteprime([...anteprime, ...nuove.map((f) => URL.createObjectURL(f))]);
    setRighe(null);
  }

  async function leggi() {
    setErrore('');
    setRighe(null);
    setLettura({ pagina: 1, di: foto.length, perc: 0 });
    let testo = '';
    try {
      testo = (await leggiTestoFoto(foto, setLettura)).join('\n');
    } catch (e) {
      setLettura(null);
      setErrore(erroreLettura(e));
      return;
    }
    setLettura(null);
    const proposte = proponi(estraiVoci(testo), p.clienti, p.prefisso);
    const ordine = { sicuro: 0, incerto: 1, nessuno: 2 };
    setRighe(
      proposte
        .map((x) => ({
          ...x,
          numeroScritto: x.telefono,
          scelto: x.esito === 'sicuro' && !x.giaUsatoDa && numeroPlausibile(x.telefono),
        }))
        .sort((a, b) => ordine[a.esito] - ordine[b.esito]),
    );
  }

  const cambia = (i: number, pezzo: Partial<Riga>) => righe && setRighe(righe.map((r, j) => (j === i ? { ...r, ...pezzo } : r)));
  const numeroDi = (r: Riga) => normalizzaTelefono(r.numeroScritto, p.prefisso);
  const usatoDa = (r: Riga) => {
    const n = numeroDi(r);
    return p.clienti.find((c) => c.telefono && normalizzaTelefono(c.telefono, p.prefisso) === n);
  };
  // lo stesso cliente scelto su più righe: vale solo la prima
  const doppi = new Set<number>();
  const visti = new Set<number>();
  for (const r of righe ?? [])
    if (r.scelto && r.clientId) {
      if (visti.has(r.clientId)) doppi.add(r.clientId);
      visti.add(r.clientId);
    }
  const valide = (righe ?? []).filter((r) => r.scelto && r.clientId && numeroPlausibile(numeroDi(r)));
  const daAggiungere = new Set(valide.map((r) => r.clientId)).size;

  async function salva() {
    setSalvo(true);
    let aggiornati = 0;
    let saltati = 0;
    const fatti = new Set<number>();
    for (const r of valide) {
      if (fatti.has(r.clientId!)) continue;
      fatti.add(r.clientId!);
      const c = await db.clienti.get(r.clientId!);
      // nel frattempo qualcuno ha già inserito il numero: non si sovrascrive
      if (!c || c.telefono?.trim()) {
        saltati++;
        continue;
      }
      await db.clienti.update(c.id!, { telefono: numeroDi(r) });
      aggiornati++;
    }
    anteprime.forEach((u) => URL.revokeObjectURL(u));
    p.onChiudi(
      `Rubrica cartacea: ${aggiornati} ${aggiornati === 1 ? 'telefono aggiunto' : 'telefoni aggiunti'}${saltati ? `, ${saltati} saltati perché il cliente aveva già un numero` : ''}.`,
    );
  }

  const mostrate = (righe ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !soloAbbinate || r.clientId || r.scelto);

  return (
    <Modale
      titolo="Telefoni dalla rubrica cartacea"
      largo
      onChiudi={() => p.onChiudi()}
      azioni={
        <>
          <button onClick={() => p.onChiudi()}>Annulla</button>
          <span className="spazio" />
          {righe && (
            <button className="primario" disabled={!daAggiungere || salvo} onClick={salva}>
              {salvo ? 'Salvataggio…' : `Aggiungi ${daAggiungere} ${daAggiungere === 1 ? 'numero' : 'numeri'}`}
            </button>
          )}
        </>
      }
    >
      <p className="tenue">
        Fotografa le pagine della rubrica: l'app legge nomi e numeri e li abbina ai <b>{senzaNumero.length} clienti senza telefono</b>. Si
        aggiunge solo il numero, solo a chi non ce l'ha: gli altri dati non cambiano. Prima di salvare controlli tu ogni riga. Le foto
        restano su questo dispositivo.
      </p>

      <div className="riga a-capo">
        <label className="bottone">
          📷 {foto.length ? 'Aggiungi pagina' : 'Fotografa o scegli le pagine'}
          <input type="file" accept="image/*" multiple hidden onChange={(e) => scegliFoto(e.target.files)} />
        </label>
        {foto.length > 0 && <span className="tenue">{foto.length === 1 ? '1 pagina' : `${foto.length} pagine`}</span>}
        <span className="spazio" />
        {foto.length > 0 && (
          <button className="primario" disabled={!!lettura} onClick={leggi}>
            {righe ? 'Rileggi' : 'Leggi i numeri'}
          </button>
        )}
      </div>
      {anteprime.length > 0 && (
        <div className="rubrica-anteprime">
          {anteprime.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" title="Apri la foto">
              <img src={u} alt={`Pagina ${i + 1} della rubrica`} />
            </a>
          ))}
        </div>
      )}
      <p className="tenue">
        Consigli: pagina ben illuminata e dritta, una pagina per foto, inquadrata da vicino. La scrittura in stampatello si legge meglio del
        corsivo.
      </p>

      {lettura && (
        <p className="nota">
          Lettura pagina {lettura.pagina} di {lettura.di}… {lettura.perc}%
        </p>
      )}
      {errore && <p className="avviso">{errore}</p>}

      {righe && (
        <>
          <div className="riga a-capo">
            <b>
              {righe.length} righe con un numero · {righe.filter((r) => r.clientId).length} abbinate a clienti senza telefono
            </b>
            <span className="spazio" />
            <label className="spunta">
              <input type="checkbox" checked={soloAbbinate} onChange={(e) => setSoloAbbinate(e.target.checked)} />
              Solo righe abbinate
            </label>
          </div>
          {!righe.length && <p className="avviso">Non ho trovato numeri di telefono nella foto: prova con una foto più nitida o più vicina.</p>}
          <div className="tabella-scorri">
            <table className="tabella-stat rubrica-righe">
              <thead>
                <tr>
                  <th>Aggiungi</th>
                  <th>Sulla carta</th>
                  <th>Cliente senza telefono</th>
                  <th>Numero</th>
                </tr>
              </thead>
              <tbody>
                {mostrate.map(({ r, i }) => {
                  const altro = usatoDa(r);
                  const valido = numeroPlausibile(numeroDi(r));
                  return (
                    <tr key={i} className={r.scelto ? 'scelta' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label="Aggiungi questo numero"
                          checked={r.scelto}
                          disabled={!r.clientId}
                          onChange={(e) => cambia(i, { scelto: e.target.checked })}
                        />
                      </td>
                      <td>
                        {r.voce.testo}
                        {r.esito === 'incerto' && <span className="etichetta gialla">da controllare</span>}
                      </td>
                      <td>
                        <select
                          value={r.clientId ?? ''}
                          aria-label="Cliente"
                          onChange={(e) => {
                            const id = e.target.value ? Number(e.target.value) : undefined;
                            cambia(i, { clientId: id, scelto: !!id && valido && !altro });
                          }}
                        >
                          <option value="">— nessuno —</option>
                          {senzaNumero.map((c) => (
                            <option key={c.id} value={c.id}>
                              {nomeCliente(c)}
                            </option>
                          ))}
                        </select>
                        {r.clientId && doppi.has(r.clientId) && <span className="etichetta gialla">cliente su più righe: vale la prima</span>}
                      </td>
                      <td>
                        <input
                          className="numero-rubrica"
                          inputMode="tel"
                          value={r.numeroScritto}
                          aria-label="Numero di telefono"
                          onChange={(e) => cambia(i, { numeroScritto: e.target.value })}
                        />
                        {!valido && <span className="etichetta gialla">numero incompleto</span>}
                        {altro && <span className="etichetta gialla">già di {nomeCliente(altro)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="tenue">
            Spuntate in automatico solo le righe in cui nome e cognome corrispondono. Correggi il numero o scegli il cliente giusto dove
            serve; le righe «da controllare» vanno spuntate a mano.
          </p>
        </>
      )}
    </Modale>
  );
}
