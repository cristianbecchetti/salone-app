import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from '../db';
import type { Appuntamento, FaseApp, Servizio, Stato, TipoFase } from '../types';
import { allineaPose, fasceSalone, impegniDa, trovaSlot, turnoOperatore, verifica, type Slot } from '../lib/slots';
import { dataLunga, dataNum, hm, minuti, oggi, oraMinuti, piuGiorni } from '../lib/tempo';
import { linkWhatsApp, normalizzaTelefono } from '../lib/contatti';
import { testoConferma } from '../lib/messaggi';
import { Ora, Pallino, nomeCliente } from '../ui';

export interface Pre {
  data?: string;
  inizio?: number;
  staffId?: number;
  clientId?: number;
}

interface Bozza {
  serviceId: number;
  servizio: string;
  nome: string;
  tipo: TipoFase;
  durata: number;
  variabile: boolean;
  min?: number;
  max?: number;
  staffId: number | null;
  competenza?: string;
  daStorico?: boolean;
}

const STATI: [Stato, string][] = [
  ['prenotato', 'Prenotato'],
  ['completato', 'Completato'],
  ['assente', 'Non presentato'],
  ['annullato', 'Annullato'],
];

export default function Prenota({ id, pre, onFine }: { id?: number; pre?: Pre; onFine: (data?: string) => void }) {
  const imp = useImpostazioni();
  const servizi = useLiveQuery(() => db.servizi.toArray(), []) ?? [];
  const operatori = useLiveQuery(() => db.operatori.toArray(), []) ?? [];
  const clienti = useLiveQuery(() => db.clienti.toArray(), []) ?? [];
  const eccezioni = useLiveQuery(() => db.eccezioni.toArray(), []) ?? [];

  const [clientId, setClientId] = useState<number | null>(pre?.clientId ?? null);
  const [cerca, setCerca] = useState('');
  const [nuovo, setNuovo] = useState<{ nome: string; cognome: string; telefono: string } | null>(null);
  const [bozza, setBozza] = useState<Bozza[]>([]);
  const [data, setData] = useState(pre?.data ?? oggi());
  const [inizio, setInizio] = useState<number | null>(pre?.inizio ?? null);
  const [stato, setStato] = useState<Stato>('prenotato');
  const [note, setNote] = useState('');
  /** null = segue l'impostazione dei servizi scelti */
  const [invia, setInvia] = useState<boolean | null>(null);
  const [originale, setOriginale] = useState<Appuntamento | null>(null);
  const [tutti, setTutti] = useState(false);
  const [filtroOp, setFiltroOp] = useState(0);
  const [msg, setMsg] = useState('');

  const delGiorno = useLiveQuery(() => db.appuntamenti.where('data').equals(data).toArray(), [data]) ?? [];
  const storico =
    useLiveQuery(
      () => (clientId ? db.appuntamenti.where('clientId').equals(clientId).toArray() : Promise.resolve([] as Appuntamento[])),
      [clientId],
    ) ?? [];
  const passati = useMemo(
    () =>
      storico
        .filter((a) => a.id !== id && a.stato !== 'annullato')
        .sort((a, b) => b.data.localeCompare(a.data) || b.inizio - a.inizio),
    [storico, id],
  );

  // modifica di un appuntamento esistente
  useEffect(() => {
    if (!id) return;
    (async () => {
      const a = await db.appuntamenti.get(id);
      if (!a) return;
      const sv = await db.servizi.toArray();
      setOriginale(a);
      setClientId(a.clientId);
      setData(a.data);
      setInizio(a.inizio);
      setStato(a.stato);
      setNote(a.note);
      setBozza(
        a.fasi.map((f) => {
          const def = sv.find((s) => s.id === f.serviceId)?.fasi.find((x) => x.nome === f.nome);
          return {
            serviceId: f.serviceId,
            servizio: f.servizio,
            nome: f.nome,
            tipo: f.tipo,
            durata: f.durata,
            staffId: f.staffId,
            competenza: f.competenza ?? def?.competenza,
            variabile: def?.variabile ?? true,
            min: def?.min,
            max: def?.max,
          };
        }),
      );
    })();
  }, [id]);

  const cliente = clienti.find((c) => c.id === clientId);
  const serviceIds = [...new Set(bozza.map((b) => b.serviceId))];
  const totale = bozza.reduce((s, b) => s + b.durata, 0);
  const attivi = operatori.filter((o) => o.attivo);

  function fasiDa(s: Servizio, da?: Appuntamento): Bozza[] {
    const staff = bozza.find((b) => b.tipo === 'lavoro')?.staffId ?? pre?.staffId ?? null;
    return s.fasi.map((f) => {
      const precedente = f.variabile ? da?.fasi.find((x) => x.serviceId === s.id && x.nome === f.nome)?.durata : undefined;
      return {
        serviceId: s.id!,
        servizio: s.nome,
        nome: f.nome,
        tipo: f.tipo,
        durata: precedente ?? f.durata,
        variabile: f.variabile,
        min: f.min,
        max: f.max,
        staffId: staff,
        competenza: f.competenza,
        daStorico: precedente != null && precedente !== f.durata,
      };
    });
  }

  function toggleServizio(s: Servizio) {
    if (bozza.some((b) => b.serviceId === s.id)) setBozza(bozza.filter((b) => b.serviceId !== s.id));
    else {
      // per le fasi variabili riparte dai tempi dell'ultima visita del cliente
      const ultima = passati.find((a) => a.fasi.some((f) => f.serviceId === s.id));
      setBozza([...bozza, ...fasiDa(s, ultima)]);
    }
  }

  function ripeti(a: Appuntamento) {
    const ids = [...new Set(a.fasi.map((f) => f.serviceId))];
    const nuove = ids.flatMap((sid) => {
      const s = servizi.find((x) => x.id === sid);
      return s ? fasiDa(s, a) : [];
    });
    setBozza(nuove);
  }

  // fasi consecutive dello stesso servizio formano un gruppo, che si può spostare in blocco
  const gruppi_servizi: { da: number; a: number }[] = [];
  bozza.forEach((b, i) => {
    const ultimo = gruppi_servizi[gruppi_servizi.length - 1];
    if (ultimo && bozza[ultimo.da].serviceId === b.serviceId) ultimo.a = i + 1;
    else gruppi_servizi.push({ da: i, a: i + 1 });
  });
  function spostaServizio(da: number, verso: -1 | 1) {
    const k = gruppi_servizi.findIndex((g) => g.da === da);
    const altro = gruppi_servizi[k + verso];
    if (k < 0 || !altro) return;
    const [primo, secondo] = verso < 0 ? [altro, gruppi_servizi[k]] : [gruppi_servizi[k], altro];
    setBozza([
      ...bozza.slice(0, primo.da),
      ...bozza.slice(secondo.da, secondo.a),
      ...bozza.slice(primo.da, primo.a),
      ...bozza.slice(secondo.a),
    ]);
  }
  function spostaFase(i: number, verso: -1 | 1) {
    if (i + verso < 0 || i + verso >= bozza.length) return;
    const nuova = [...bozza];
    [nuova[i], nuova[i + verso]] = [nuova[i + verso], nuova[i]];
    setBozza(nuova);
  }

  const cambiaDurata =(i: number, delta: number) =>
    setBozza(bozza.map((b, j) => (j === i ? { ...b, durata: Math.max(5, b.durata + delta), daStorico: false } : b)));

  function slotDelGiorno(g: string, appuntamenti: Appuntamento[]): Slot[] {
    const salone = fasceSalone(g, imp.settimana, eccezioni);
    return trovaSlot({
      fasi: bozza,
      salone,
      operatori: attivi.map((o) => ({ id: o.id!, turno: turnoOperatore(o, g, salone), competenze: o.competenze })),
      impegni: impegniDa(appuntamenti, id),
      passo: imp.passo,
      nonPrimaDi: g === oggi() ? oraMinuti() : 0,
      ancheSenzaSkill: tutti,
    }).filter((s) => !filtroOp || s.staff.includes(filtroOp));
  }

  const salone = fasceSalone(data, imp.settimana, eccezioni);
  const slot = bozza.length ? slotDelGiorno(data, delGiorno) : [];

  async function primoDisponibile() {
    setMsg('');
    const da = data < oggi() ? oggi() : data;
    const futuri = await db.appuntamenti.where('data').between(da, piuGiorni(da, 60), true, true).toArray();
    for (let i = 0; i <= 60; i++) {
      const g = piuGiorni(da, i);
      if (slotDelGiorno(g, futuri.filter((a) => a.data === g)).length) {
        setData(g);
        return;
      }
    }
    setMsg('Nessuno slot libero nei prossimi 60 giorni con questi criteri.');
  }

  function scegliSlot(s: Slot) {
    setInizio(s.inizio);
    setBozza(bozza.map((b, i) => ({ ...b, staffId: s.staff[i] })));
  }
  const sceltoSlot = (s: Slot) =>
    inizio === s.inizio && bozza.every((b, i) => b.tipo !== 'lavoro' || b.staffId === s.staff[i]);

  // slot raggruppati per operatore, o per squadra quando le fasi vanno a operatori diversi
  const nomeOp = (sid: number | null) => operatori.find((o) => o.id === sid)?.nome ?? '?';
  const gruppi = new Map<string, { chiave: string; etichetta: string; colori: string[]; misto: boolean; haSkill: boolean; lista: Slot[] }>();
  for (const s of slot) {
    const chiave = s.staff.join('-');
    let g = gruppi.get(chiave);
    if (!g) {
      const tratti: { sid: number; fasi: string[] }[] = [];
      s.staff.forEach((sid, i) => {
        if (sid == null) return;
        const ultimo = tratti[tratti.length - 1];
        if (ultimo?.sid === sid) ultimo.fasi.push(bozza[i].nome);
        else tratti.push({ sid, fasi: [bozza[i].nome] });
      });
      const misto = tratti.length > 1;
      g = {
        chiave,
        misto,
        haSkill: s.haSkill,
        colori: tratti.map((t) => operatori.find((o) => o.id === t.sid)?.colore ?? '#777'),
        etichetta: misto ? tratti.map((t) => `${nomeOp(t.sid)} (${t.fasi.join(' + ')})`).join(' → ') : nomeOp(tratti[0]?.sid ?? null),
        lista: [],
      };
      gruppi.set(chiave, g);
    }
    g.lista.push(s);
  }
  const singoli = [...gruppi.values()].filter((g) => !g.misto);
  const squadre = [...gruppi.values()].filter((g) => g.misto);
  const rigaGruppo = (g: (typeof singoli)[number]) => (
    <div className="slot-op" key={g.chiave}>
      <div className="riga a-capo">
        {g.colori.map((c, i) => (
          <Pallino colore={c} key={i} />
        ))}
        <strong>{g.etichetta}</strong>
        {!g.haSkill && <span className="etichetta gialla">senza skill</span>}
      </div>
      <div className="chips">
        {g.lista.map((s) => (
          <button key={s.inizio} className={`chip ora${sceltoSlot(s) ? ' scelto' : ''}`} onClick={() => scegliSlot(s)}>
            {hm(s.inizio)}
          </button>
        ))}
      </div>
    </div>
  );

  // fasi con orario, come verranno salvate
  const fasi: FaseApp[] = useMemo(() => {
    if (inizio == null) return [];
    let c = inizio;
    const out = bozza.map((b) => {
      const f: FaseApp = {
        serviceId: b.serviceId,
        servizio: b.servizio,
        nome: b.nome,
        tipo: b.tipo,
        inizio: c,
        durata: b.durata,
        staffId: b.tipo === 'lavoro' ? b.staffId : null,
      };
      if (b.competenza) f.competenza = b.competenza;
      c += b.durata;
      return f;
    });
    // la posa viene mostrata nella colonna dell'operatore che l'ha preparata
    return allineaPose(out);
  }, [bozza, inizio]);

  const avvisi = fasi.length
    ? verifica({
        data,
        fasi: fasi.map((f) => ({ ...f, staffId: f.tipo === 'lavoro' ? f.staffId : null })),
        salone,
        operatori,
        impegni: impegniDa(delGiorno, id),
      })
    : [];
  if (fasi.length && data < oggi() && stato === 'prenotato') avvisi.push('La data scelta è già passata.');

  async function creaCliente() {
    if (!nuovo || !(nuovo.nome.trim() || nuovo.cognome.trim())) return;
    const nid = await db.clienti.add({
      nome: nuovo.nome.trim(),
      cognome: nuovo.cognome.trim(),
      telefono: normalizzaTelefono(nuovo.telefono, imp.prefisso),
      note: '',
    });
    setClientId(nid);
    setNuovo(null);
    setCerca('');
  }

  const pronto = clientId != null && inizio != null && bozza.length > 0;
  // nuova prenotazione: proposto se almeno un servizio scelto lo prevede; in modifica: solo se lo si spunta
  const inviaProposto = !id && serviceIds.some((sid) => servizi.find((s) => s.id === sid)?.inviaConferma);
  const inviaConferma = !!cliente?.telefono && (invia ?? inviaProposto);
  async function salva() {
    if (!pronto) return;
    const spostato = !originale || originale.data !== data || originale.inizio !== inizio;
    const a: Appuntamento = {
      clientId: clientId!,
      data,
      inizio: inizio!,
      fine: inizio! + totale,
      fasi,
      stato,
      note,
      reminderInviatoIl: spostato ? undefined : originale?.reminderInviatoIl,
    };
    if (id) a.id = id;
    a.id = await db.appuntamenti.put(a);
    // apre WhatsApp con la conferma già scritta: l'invio resta un tocco dell'operatore
    if (inviaConferma && cliente) window.open(linkWhatsApp(cliente.telefono, testoConferma(a, cliente, imp)), '_blank');
    onFine(data);
  }

  async function elimina() {
    if (id && confirm('Eliminare definitivamente questo appuntamento?')) {
      await db.appuntamenti.delete(id);
      onFine(data);
    }
  }

  const q = cerca.trim().toLowerCase();
  const trovati = clienti
    .filter((c) => !q || `${c.nome} ${c.cognome} ${c.telefono}`.toLowerCase().includes(q))
    .sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b)))
    .slice(0, 8);
  const nomiServizi = (a: Appuntamento) => [...new Set(a.fasi.map((f) => f.servizio))].join(', ');

  return (
    <div className="pagina">
      <header className="testata">
        <button onClick={() => onFine()}>← Agenda</button>
        <h1>{id ? 'Modifica appuntamento' : 'Nuovo appuntamento'}</h1>
        <span className="spazio" />
        {id && (
          <button className="pericolo" onClick={elimina}>
            Elimina
          </button>
        )}
      </header>

      <div className="due-colonne">
        <div className="colonna">
          <section className="scheda">
            <h3>1 · Cliente</h3>
            {cliente ? (
              <>
                <div className="riga">
                  <div>
                    <strong>{nomeCliente(cliente)}</strong>
                    <div className="tenue">{cliente.telefono || 'nessun telefono'}</div>
                  </div>
                  <span className="spazio" />
                  <button className="piccolo" onClick={() => setClientId(null)}>
                    Cambia
                  </button>
                </div>
                {cliente.note && <p className="nota">{cliente.note}</p>}
                {passati.length > 0 && (
                  <div className="storico">
                    <span className="tenue">Ultime visite</span>
                    {passati.slice(0, 3).map((a) => (
                      <div className="riga" key={a.id}>
                        <span>
                          {dataNum(a.data)} · {nomiServizi(a)} <span className="tenue">({minuti(a.fine - a.inizio)})</span>
                        </span>
                        <span className="spazio" />
                        <button className="piccolo" onClick={() => ripeti(a)}>
                          Ripeti
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : nuovo ? (
              <div className="griglia-form">
                <input placeholder="Nome" value={nuovo.nome} onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })} autoFocus />
                <input placeholder="Cognome" value={nuovo.cognome} onChange={(e) => setNuovo({ ...nuovo, cognome: e.target.value })} />
                <input placeholder="Cellulare" inputMode="tel" value={nuovo.telefono} onChange={(e) => setNuovo({ ...nuovo, telefono: e.target.value })} />
                <div className="riga">
                  <button className="primario" onClick={creaCliente}>
                    Aggiungi cliente
                  </button>
                  <button onClick={() => setNuovo(null)}>Annulla</button>
                </div>
              </div>
            ) : (
              <>
                <div className="riga">
                  <input className="cresce" placeholder="Cerca per nome o telefono…" value={cerca} onChange={(e) => setCerca(e.target.value)} />
                  <button onClick={() => setNuovo({ nome: cerca, cognome: '', telefono: '' })}>+ Nuovo</button>
                </div>
                <div className="elenco compatto">
                  {trovati.map((c) => (
                    <button key={c.id} className="voce" onClick={() => setClientId(c.id!)}>
                      <strong>{nomeCliente(c)}</strong>
                      <span className="tenue">{c.telefono}</span>
                    </button>
                  ))}
                  {!trovati.length && <p className="tenue">Nessun cliente trovato.</p>}
                </div>
              </>
            )}
          </section>

          <section className="scheda">
            <h3>2 · Servizi</h3>
            <div className="chips">
              {servizi
                .filter((s) => s.attivo || serviceIds.includes(s.id!))
                .map((s) => (
                  <button key={s.id} className={`chip${serviceIds.includes(s.id!) ? ' scelto' : ''}`} onClick={() => toggleServizio(s)}>
                    {s.nome}
                  </button>
                ))}
            </div>
            {bozza.length > 0 && (
              <>
                <h4>
                  Tempi <span className="tenue">· totale {minuti(totale)}</span>
                </h4>
                <p className="tenue">
                  Con ✕ togli una fase che non serve (es. una piega doppia), con le frecce decidi cosa fare prima.
                </p>
                <div className="fasi-bozza">
                  {bozza.map((b, i) => (
                    <Fragment key={i}>
                      {gruppi_servizi.length > 1 && gruppi_servizi.some((g) => g.da === i) && (
                        <div className="gruppo-servizio">
                          <strong>{b.servizio}</strong>
                          <span className="spazio" />
                          <button className="piccolo" disabled={i === 0} onClick={() => spostaServizio(i, -1)} aria-label={`Anticipa ${b.servizio}`}>
                            ↑ prima
                          </button>
                          <button
                            className="piccolo"
                            disabled={gruppi_servizi[gruppi_servizi.length - 1].da === i}
                            onClick={() => spostaServizio(i, 1)}
                            aria-label={`Posticipa ${b.servizio}`}
                          >
                            ↓ dopo
                          </button>
                        </div>
                      )}
                    <div className={`fase-riga ${b.tipo}`}>
                      <div className="ordina">
                        <button className="icona" disabled={i === 0} onClick={() => spostaFase(i, -1)} aria-label={`Sposta su ${b.nome}`}>
                          ↑
                        </button>
                        <button className="icona" disabled={i === bozza.length - 1} onClick={() => spostaFase(i, 1)} aria-label={`Sposta giù ${b.nome}`}>
                          ↓
                        </button>
                      </div>
                      <div className="cresce">
                        <strong>{b.nome}</strong>
                        <div className="tenue">
                          {b.servizio} · {b.tipo === 'posa' ? 'posa, operatore libero' : b.competenza ? `skill ${b.competenza}` : 'lavoro'}
                          {b.variabile && b.min != null && b.max != null && ` · standard ${b.min}–${b.max}′`}
                          {b.daStorico && ' · come ultima visita'}
                        </div>
                      </div>
                      {b.variabile ? (
                        <div className="stepper">
                          <button onClick={() => cambiaDurata(i, -5)} aria-label={`Riduci ${b.nome}`}>
                            −
                          </button>
                          <b>{b.durata}′</b>
                          <button onClick={() => cambiaDurata(i, 5)} aria-label={`Aumenta ${b.nome}`}>
                            +
                          </button>
                        </div>
                      ) : (
                        <b className="fisso">{b.durata}′</b>
                      )}
                      <button className="icona" onClick={() => setBozza(bozza.filter((_, j) => j !== i))} aria-label={`Togli ${b.nome} (${b.servizio})`}>
                        ✕
                      </button>
                    </div>
                    </Fragment>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <div className="colonna">
          <section className="scheda">
            <h3>3 · Giorno e orario</h3>
            <div className="riga a-capo">
              <button onClick={() => setData(piuGiorni(data, -1))} aria-label="Giorno precedente">
                ‹
              </button>
              <input type="date" aria-label="Data dell'appuntamento" value={data} onChange={(e) => e.target.value && setData(e.target.value)} />
              <button onClick={() => setData(piuGiorni(data, 1))} aria-label="Giorno successivo">
                ›
              </button>
              <strong className="capitalizza">{dataLunga(data)}</strong>
            </div>
            <div className="riga a-capo">
              <select value={filtroOp} onChange={(e) => setFiltroOp(Number(e.target.value))} aria-label="Operatore">
                <option value={0}>Qualsiasi operatore</option>
                {attivi.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
              <label className="spunta">
                <input type="checkbox" checked={tutti} onChange={(e) => setTutti(e.target.checked)} />
                anche chi non ha la skill
              </label>
              <button className="piccolo" disabled={!bozza.length} onClick={primoDisponibile}>
                Primo giorno libero
              </button>
            </div>
            {msg && <p className="avviso">{msg}</p>}

            {!bozza.length ? (
              <p className="tenue">Scegli almeno un servizio per vedere gli orari liberi.</p>
            ) : !salone.length ? (
              <p className="avviso">Il salone è chiuso in questa data.</p>
            ) : !slot.length ? (
              <p className="avviso">
                Nessuno slot libero in questo giorno.
                {!tutti && ' Prova ad attivare "anche chi non ha la skill".'}
              </p>
            ) : (
              <>
                {singoli.map(rigaGruppo)}
                {squadre.length > 0 && (
                  <details className="squadre" open={!singoli.length}>
                    <summary>Dividendo il lavoro tra più operatori ({squadre.length})</summary>
                    {squadre.map(rigaGruppo)}
                  </details>
                )}
              </>
            )}
          </section>

          <section className="scheda">
            <h3>4 · Riepilogo</h3>
            <div className="riga a-capo">
              <label className="spunta">
                Inizio
                <input
                  type="time"
                  step={300}
                  value={inizio == null ? '' : hm(inizio)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setInizio(e.target.value ? h * 60 + m : null);
                  }}
                />
              </label>
              {inizio != null && bozza.length > 0 && (
                <span>
                  fine <strong>{hm(inizio + totale)}</strong>
                </span>
              )}
              <span className="tenue">Puoi cambiare a mano orario e operatori.</span>
            </div>
            {fasi.length > 0 && (
              <table className="riepilogo">
                <tbody>
                  {fasi.map((f, i) => (
                    <tr key={i} className={f.tipo}>
                      <td className="orario">
                        {hm(f.inizio)}–{hm(f.inizio + f.durata)}
                      </td>
                      <td>
                        {f.nome}
                        <div className="tenue">{f.servizio}</div>
                      </td>
                      <td>
                        {f.tipo === 'posa' ? (
                          <span className="tenue">posa · operatore libero</span>
                        ) : (
                          <select
                            aria-label={`Operatore per ${f.nome}`}
                            value={bozza[i].staffId ?? 0}
                            onChange={(e) =>
                              setBozza(bozza.map((b, j) => (j === i ? { ...b, staffId: Number(e.target.value) || null } : b)))
                            }
                          >
                            <option value={0}>— da assegnare —</option>
                            {operatori
                              .filter((o) => o.attivo || o.id === bozza[i].staffId)
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.nome}
                                  {!f.competenza || o.competenze.includes(f.competenza) ? '' : ' (senza skill)'}
                                </option>
                              ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {avvisi.map((a) => (
              <p className="avviso" key={a}>
                ⚠ {a}
              </p>
            ))}
            <textarea placeholder="Note sull'appuntamento" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            {id && (
              <div className="chips">
                {STATI.map(([s, nome]) => (
                  <button key={s} className={`chip${stato === s ? ' scelto' : ''}`} onClick={() => setStato(s)}>
                    {nome}
                  </button>
                ))}
              </div>
            )}
            <label className="spunta">
              <input
                type="checkbox"
                checked={inviaConferma}
                disabled={!cliente?.telefono}
                onChange={(e) => setInvia(e.target.checked)}
              />
              {id ? 'Invia la conferma aggiornata su WhatsApp' : 'Invia conferma su WhatsApp'}
              {cliente && !cliente.telefono && <span className="tenue">(il cliente non ha un cellulare)</span>}
            </label>
            <div className="riga">
              <button className="primario grande" disabled={!pronto} onClick={salva}>
                {(avvisi.length ? 'Salva comunque' : id ? 'Salva modifiche' : 'Conferma appuntamento') + (inviaConferma ? ' e invia' : '')}
              </button>
              {!pronto && (
                <span className="tenue">
                  {clientId == null ? 'Manca il cliente' : !bozza.length ? 'Manca il servizio' : "Manca l'orario"}
                </span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
