// Statistiche: appuntamenti svolti, non presentati e annullati; servizi, operatori e clienti del periodo.
import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Rotta } from '../App';
import { calcola, daRichiamare, tassoAnnullati, tassoAssenze, type StatCliente } from '../lib/statistiche';
import { nomeMese } from '../lib/messaggi';
import { aData, dataNum, iso, minuti, oggi, piuGiorni } from '../lib/tempo';
import { SceltaData } from '../scelte';
import { nomeCliente, Pallino } from '../ui';

type Periodo = 'mese' | 'scorso' | 'tre' | 'anno' | 'scelto';
const PERIODI: [Periodo, string][] = [
  ['mese', 'Questo mese'],
  ['scorso', 'Mese scorso'],
  ['tre', 'Ultimi 3 mesi'],
  ['anno', "Quest'anno"],
  ['scelto', 'Scegli date'],
];
// periodo scelto: resta tornando da una prenotazione
let ultimo: { periodo: Periodo; scelto?: [string, string] } = { periodo: 'mese' };
type Ordine = 'totale' | 'assente' | 'annullato' | 'ultima' | 'nome';

/** primo e ultimo giorno del mese che inizia `spostamento` mesi dopo quello di `g` */
function mese(g: string, spostamento = 0): [string, string] {
  const d = aData(g);
  const inizio = new Date(d.getFullYear(), d.getMonth() + spostamento, 1);
  const fine = new Date(d.getFullYear(), d.getMonth() + spostamento + 1, 0);
  return [iso(inizio), iso(fine)];
}
const perc = (x: number) => `${Math.round(x * 100)}%`;

function Barre(p: { righe: { chiave: string | number; nome: ReactNode; valore: number; testo: string }[] }) {
  const max = Math.max(1, ...p.righe.map((r) => r.valore));
  return (
    <div className="barre">
      {p.righe.map((r) => (
        <div className="barra-riga" key={r.chiave} title={r.testo}>
          <span className="barra-nome">{r.nome}</span>
          <span className="barra-fondo">
            <span className="barra" style={{ width: `${(r.valore / max) * 100}%` }} />
          </span>
          <span className="barra-valore">{r.testo}</span>
        </div>
      ))}
    </div>
  );
}

export default function Statistiche({ vai }: { vai: (r: Rotta) => void }) {
  const [periodo, setPeriodoStato] = useState<Periodo>(ultimo.periodo);
  const [scelto, setSceltoStato] = useState<[string, string]>(() => ultimo.scelto ?? [piuGiorni(oggi(), -30), oggi()]);
  const setPeriodo = (p: Periodo) => {
    ultimo = { ...ultimo, periodo: p };
    setPeriodoStato(p);
  };
  const setScelto = (x: [string, string]) => {
    ultimo = { ...ultimo, scelto: x };
    setSceltoStato(x);
  };
  const [cerca, setCerca] = useState('');
  const [ordine, setOrdine] = useState<Ordine>('totale');
  const [soloProblemi, setSoloProblemi] = useState(false);
  const [giorniAssenza, setGiorniAssenza] = useState(90);
  const appuntamenti = useLiveQuery(() => db.appuntamenti.toArray(), []);
  const clienti = useLiveQuery(() => db.clienti.toArray(), []) ?? [];
  const operatori = useLiveQuery(() => db.operatori.toArray(), []) ?? [];

  const g = oggi();
  const [dal, al] =
    periodo === 'mese'
      ? mese(g)
      : periodo === 'scorso'
        ? mese(g, -1)
        : periodo === 'tre'
          ? [mese(g, -2)[0], mese(g)[1]]
          : periodo === 'anno'
            ? [`${g.slice(0, 4)}-01-01`, `${g.slice(0, 4)}-12-31`]
            : scelto;
  const s = useMemo(() => calcola(appuntamenti ?? [], dal, al, g), [appuntamenti, dal, al, g]);
  const richiamare = useMemo(() => daRichiamare(appuntamenti ?? [], g, giorniAssenza), [appuntamenti, g, giorniAssenza]);
  if (!appuntamenti) return null;

  const cliente = (id: number) => clienti.find((c) => c.id === id);
  const c = s.conteggi;
  const testo = cerca.trim().toLowerCase();
  const righe = s.clienti
    .filter((x) => !soloProblemi || x.assente || x.annullato)
    .filter((x) => !testo || `${nomeCliente(cliente(x.clientId))} ${cliente(x.clientId)?.telefono ?? ''}`.toLowerCase().includes(testo))
    .sort((x: StatCliente, y: StatCliente) =>
      ordine === 'nome'
        ? nomeCliente(cliente(x.clientId)).localeCompare(nomeCliente(cliente(y.clientId)))
        : ordine === 'ultima'
          ? (y.ultimaVisita ?? '').localeCompare(x.ultimaVisita ?? '')
          : y[ordine] - x[ordine] || y.totale - x.totale,
    );

  const tessere: [string, string, string?][] = [
    ['Appuntamenti', String(c.totale), `${c.futuro} in programma`],
    ['Svolti', String(c.fatto)],
    ['Non presentati', String(c.assente), `${perc(tassoAssenze(c))} di quelli già passati`],
    ['Annullati', String(c.annullato), `${perc(tassoAnnullati(c))} del totale`],
    ['Clienti', String(s.clientiAttivi), `${s.clientiNuovi} nuovi`],
  ];

  return (
    <div className="pagina statistiche">
      <header className="testata">
        <h1>Statistiche</h1>
        <span className="spazio" />
        <div className="segmenti">
          {PERIODI.map(([p, nome]) => (
            <button key={p} className={periodo === p ? 'attivo' : ''} onClick={() => setPeriodo(p)}>
              {nome}
            </button>
          ))}
        </div>
      </header>
      {periodo === 'scelto' && (
        <div className="riga a-capo">
          <span>Dal</span>
          <SceltaData valore={scelto[0]} label="Statistiche dal" onChange={(d) => setScelto([d, scelto[1] < d ? d : scelto[1]])} />
          <span>al</span>
          <SceltaData valore={scelto[1]} min={scelto[0]} label="Statistiche fino al" onChange={(d) => setScelto([scelto[0], d])} />
        </div>
      )}
      <p className="tenue">
        Dal {dataNum(dal)} al {dataNum(al)}. Gli appuntamenti passati ancora «prenotati» contano come svolti; segna «Assente» quelli
        in cui il cliente non si è presentato.
      </p>

      <div className="tessere">
        {tessere.map(([nome, valore, nota]) => (
          <div className="tessera" key={nome}>
            <span className="tessera-nome">{nome}</span>
            <b className="tessera-valore">{valore}</b>
            {nota && <span className="tenue">{nota}</span>}
          </div>
        ))}
      </div>

      <div className="due-colonne">
        <section className="scheda">
          <h3>Servizi</h3>
          <p className="tenue">Volte in cui sono stati svolti o sono in programma (annullati e non presentati esclusi).</p>
          <Barre
            righe={s.servizi.map((x) => ({ chiave: x.serviceId, nome: x.nome, valore: x.volte, testo: `${x.volte} · ${minuti(x.minuti)}` }))}
          />
          {!s.servizi.length && <p className="tenue">Nessun servizio nel periodo.</p>}
        </section>
        <section className="scheda">
          <h3>Operatori</h3>
          <p className="tenue">Appuntamenti seguiti e ore di lavoro (le pose non contano).</p>
          <Barre
            righe={s.operatori.map((x) => {
              const o = operatori.find((y) => y.id === x.staffId);
              return {
                chiave: x.staffId ?? 0,
                nome: o ? (
                  <>
                    <Pallino colore={o.colore} /> {o.nome}
                  </>
                ) : (
                  'Da assegnare'
                ),
                valore: x.minuti,
                testo: `${x.appuntamenti} app. · ${minuti(x.minuti)}`,
              };
            })}
          />
          {!s.operatori.length && <p className="tenue">Nessun appuntamento nel periodo.</p>}
        </section>
      </div>

      {s.mesi.length > 1 && (
        <section className="scheda">
          <h3>Mese per mese</h3>
          <table className="tabella-stat">
            <thead>
              <tr>
                <th>Mese</th>
                <th>Appuntamenti</th>
                <th>Svolti</th>
                <th>Non presentati</th>
                <th>Annullati</th>
              </tr>
            </thead>
            <tbody>
              {s.mesi.map((m) => (
                <tr key={m.mese}>
                  <td className="capitalizza">{nomeMese(m.mese)}</td>
                  <td>{m.totale}</td>
                  <td>{m.fatto}</td>
                  <td>
                    {m.assente} <span className="tenue">({perc(tassoAssenze(m))})</span>
                  </td>
                  <td>
                    {m.annullato} <span className="tenue">({perc(tassoAnnullati(m))})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="scheda">
        <h3>Clienti del periodo</h3>
        <div className="riga a-capo">
          <input className="cresce" placeholder="Cerca cliente…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
          <select value={ordine} onChange={(e) => setOrdine(e.target.value as Ordine)} aria-label="Ordina clienti">
            <option value="totale">Più appuntamenti</option>
            <option value="assente">Più non presentati</option>
            <option value="annullato">Più annullati</option>
            <option value="ultima">Visita più recente</option>
            <option value="nome">Nome</option>
          </select>
          <label className="spunta">
            <input type="checkbox" checked={soloProblemi} onChange={(e) => setSoloProblemi(e.target.checked)} />
            Solo con non presentati o annullati
          </label>
        </div>
        <div className="tabella-scorri">
          <table className="tabella-stat">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Appuntamenti</th>
                <th>Svolti</th>
                <th>Non presentati</th>
                <th>Annullati</th>
                <th>Ultima visita</th>
                <th>Prossimo</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((x) => (
                <tr key={x.clientId}>
                  <td>
                    {nomeCliente(cliente(x.clientId))}
                    {x.assente >= 2 && <span className="etichetta gialla">spesso assente</span>}
                  </td>
                  <td>{x.totale}</td>
                  <td>{x.fatto}</td>
                  <td>{x.assente || '–'}</td>
                  <td>{x.annullato || '–'}</td>
                  <td>{x.ultimaVisita ? dataNum(x.ultimaVisita) : '–'}</td>
                  <td>{x.prossimo ? dataNum(x.prossimo) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!righe.length && <p className="tenue">Nessun cliente da mostrare.</p>}
      </section>

      <section className="scheda">
        <div className="riga a-capo">
          <h3>Clienti da richiamare</h3>
          <span className="spazio" />
          <select value={giorniAssenza} onChange={(e) => setGiorniAssenza(Number(e.target.value))} aria-label="Da quanto tempo non vengono">
            <option value={30}>da più di 1 mese</option>
            <option value={60}>da più di 2 mesi</option>
            <option value={90}>da più di 3 mesi</option>
            <option value={180}>da più di 6 mesi</option>
            <option value={365}>da più di un anno</option>
          </select>
        </div>
        <p className="tenue">Clienti già venuti che non tornano da tempo e non hanno appuntamenti in programma (su tutto lo storico).</p>
        {richiamare.slice(0, 100).map((x) => (
          <div className="riga voce-richiamo" key={x.clientId}>
            <span className="cresce">
              <b>{nomeCliente(cliente(x.clientId))}</b>{' '}
              <span className="tenue">
                · ultima visita {dataNum(x.ultimaVisita)} · {x.visite} {x.visite === 1 ? 'visita' : 'visite'}
              </span>
            </span>
            <button className="piccolo" onClick={() => vai({ p: 'prenota', pre: { clientId: x.clientId }, da: 'statistiche' })}>
              Prenota
            </button>
          </div>
        ))}
        {richiamare.length > 100 && <p className="tenue">… e altri {richiamare.length - 100}.</p>}
        {!richiamare.length && <p className="tenue">Nessuno: tutti i clienti sono passati di recente o hanno un appuntamento.</p>}
      </section>
    </div>
  );
}
