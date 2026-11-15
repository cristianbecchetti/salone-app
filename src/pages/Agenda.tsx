import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from '../db';
import type { Rotta } from '../App';
import type { Appuntamento, Fascia } from '../types';
import { allineaPose, fasceSalone, impegniDa, turnoOperatore, verifica } from '../lib/slots';
import { dataBreve, dataLunga, hm, lunedi, oggi, oraMinuti, piuGiorni } from '../lib/tempo';
import { nomeCliente } from '../ui';
import { SceltaData } from '../scelte';


/** Intervalli di [da, a] non coperti dalle fasce (zone "chiuso" / fuori turno). */
function buchi(fasce: Fascia[], da: number, a: number): Fascia[] {
  const out: Fascia[] = [];
  let c = da;
  for (const f of fasce) {
    if (f.da > c) out.push({ da: c, a: Math.min(f.da, a) });
    c = Math.max(c, f.a);
  }
  if (c < a) out.push({ da: c, a });
  return out.filter((f) => f.a > f.da);
}

export default function Agenda(p: { giorno: string; setGiorno: (g: string) => void; vai: (r: Rotta) => void }) {
  const { giorno, setGiorno, vai } = p;
  const [vista, setVista] = useState<'giorno' | 'settimana'>('giorno');
  const imp = useImpostazioni();
  // pixel per minuto: cresce con Altro → Dimensione testo
  const PX = 1.8 * (imp.scalaTesto ?? 1.2);
  const operatori = useLiveQuery(() => db.operatori.toArray(), []) ?? [];
  const clienti = useLiveQuery(() => db.clienti.toArray(), []) ?? [];
  const eccezioni = useLiveQuery(() => db.eccezioni.toArray(), []) ?? [];
  const lun = lunedi(giorno);
  const settimana =
    useLiveQuery(() => db.appuntamenti.where('data').between(lun, piuGiorni(lun, 6), true, true).toArray(), [lun]) ?? [];

  // trascinamento di una fase da un operatore all'altro
  const presa = useRef<{ a: Appuntamento; i: number; x0: number; y0: number; yRel0: number; attivo: boolean; timer: number } | null>(null);
  const saltaClick = useRef(false);
  /** dove finirebbe la fase se rilasciata ora: colonna (0 = da assegnare) e minuti di spostamento */
  const meta = useRef({ su: 0, delta: 0 });
  const [fantasma, setFantasma] = useState<{ x: number; y: number; testo: string; colore: string; su: number; inizio: number; durata: number } | null>(
    null,
  );
  // durante un trascinamento attivo il dito non deve far scorrere la pagina
  useEffect(() => {
    const ferma = (e: TouchEvent) => {
      if (presa.current?.attivo) e.preventDefault();
    };
    document.addEventListener('touchmove', ferma, { passive: false });
    return () => document.removeEventListener('touchmove', ferma);
  }, []);
  const [esito, setEsito] = useState<{ testo: string; avvisi: string[]; annulla: () => void } | null>(null);
  useEffect(() => {
    if (!esito) return;
    const t = setTimeout(() => setEsito(null), esito.avvisi.length ? 10_000 : 5_000);
    return () => clearTimeout(t);
  }, [esito]);

  const [adesso, setAdesso] = useState(oraMinuti());
  useEffect(() => {
    const t = setInterval(() => setAdesso(oraMinuti()), 60_000);
    return () => clearInterval(t);
  }, []);

  const visibili = (g: string) =>
    settimana.filter((a) => a.data === g && a.stato !== 'annullato').sort((a, b) => a.inizio - b.inizio);
  const cliente = (a: Appuntamento) => nomeCliente(clienti.find((c) => c.id === a.clientId));
  const servizi = (a: Appuntamento) => [...new Set(a.fasi.map((f) => f.servizio))].join(', ');
  const passoGiorni = vista === 'giorno' ? 1 : 7;

  const testata = (
    <header className="testata">
      <button onClick={() => setGiorno(piuGiorni(giorno, -passoGiorni))} aria-label="Indietro">
        ‹
      </button>
      <button onClick={() => setGiorno(oggi())}>Oggi</button>
      <button onClick={() => setGiorno(piuGiorni(giorno, passoGiorni))} aria-label="Avanti">
        ›
      </button>
      <SceltaData valore={giorno} onChange={setGiorno} label="Vai alla data" chiuso={(d) => !fasceSalone(d, imp.settimana, eccezioni).length} />
      <h1 className="capitalizza">
        {vista === 'giorno' ? dataLunga(giorno) : `${dataBreve(lun)} – ${dataBreve(piuGiorni(lun, 6))}`}
      </h1>
      <span className="spazio" />
      <div className="segmenti">
        <button className={vista === 'giorno' ? 'attivo' : ''} onClick={() => setVista('giorno')}>
          Giorno
        </button>
        <button className={vista === 'settimana' ? 'attivo' : ''} onClick={() => setVista('settimana')}>
          Settimana
        </button>
      </div>
      <button className="primario" onClick={() => vai({ p: 'prenota', pre: { data: giorno } })}>
        + Appuntamento
      </button>
    </header>
  );

  if (vista === 'settimana') {
    return (
      <div className="pagina">
        {testata}
        <div className="settimana">
          {Array.from({ length: 7 }, (_, i) => piuGiorni(lun, i)).map((g) => {
            const aperto = fasceSalone(g, imp.settimana, eccezioni);
            const lista = visibili(g);
            return (
              <div key={g} className={`giorno-sett${g === oggi() ? ' oggi' : ''}`}>
                <button
                  className="intest"
                  onClick={() => {
                    setGiorno(g);
                    setVista('giorno');
                  }}
                >
                  <strong className="capitalizza">{dataBreve(g)}</strong>
                  <span className="tenue">{aperto.length ? aperto.map((f) => `${hm(f.da)}–${hm(f.a)}`).join(' · ') : 'Chiuso'}</span>
                </button>
                {lista.map((a) => (
                  <button key={a.id} className={`voce-sett ${a.stato}`} onClick={() => vai({ p: 'prenota', id: a.id })}>
                    <b>{hm(a.inizio)}</b> {cliente(a)}
                    <span className="tenue">{servizi(a)}</span>
                  </button>
                ))}
                {!lista.length && aperto.length > 0 && <span className="tenue vuoto">—</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- vista giorno ----
  const lista = visibili(giorno);
  const salone = fasceSalone(giorno, imp.settimana, eccezioni);
  const ecc = eccezioni.find((e) => e.data === giorno);
  const usati = new Set(lista.flatMap((a) => a.fasi.map((f) => f.staffId)));
  const colonne = operatori.filter((o) => o.attivo || usati.has(o.id!));
  const senzaOp = usati.has(null);

  let da = salone.length ? salone[0].da : 9 * 60;
  let a = salone.length ? salone[salone.length - 1].a : 19 * 60;
  for (const x of lista) {
    da = Math.min(da, x.inizio);
    a = Math.max(a, x.fine);
  }
  da = Math.floor(da / 60) * 60;
  a = Math.ceil(a / 60) * 60;
  const ore = Array.from({ length: (a - da) / 60 }, (_, i) => da + i * 60);
  const altezza = (a - da) * PX;

  function tocco(e: MouseEvent<HTMLDivElement>, staffId?: number) {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const inizio = da + Math.floor(y / PX / imp.passo) * imp.passo;
    vai({ p: 'prenota', pre: { data: giorno, inizio, staffId } });
  }

  /** id dell'operatore della colonna sotto il dito (0 = "Da assegnare"), null se fuori dalla griglia */
  function colonnaSotto(x: number): number | null {
    for (const el of document.querySelectorAll<HTMLElement>('[data-staff]')) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x < r.right) return Number(el.dataset.staff);
    }
    return null;
  }

  const cimaColonne = () => document.querySelector('[data-staff]')?.getBoundingClientRect().top ?? 0;

  /**
   * Applica un trascinamento: la fase trascinata passa all'operatore `dest`,
   * e l'intero appuntamento (le fasi sono in sequenza) si sposta di `delta` minuti.
   */
  async function sposta(x: Appuntamento, i: number, dest: number | null, delta: number) {
    const prima = { fasi: x.fasi, inizio: x.inizio, fine: x.fine, reminderInviatoIl: x.reminderInviatoIl };
    const cambiaOp = dest !== x.fasi[i].staffId;
    const fasi = allineaPose(x.fasi.map((f, j) => ({ ...f, inizio: f.inizio + delta, staffId: j === i ? dest : f.staffId })));
    await db.appuntamenti.update(x.id!, {
      fasi,
      inizio: x.inizio + delta,
      fine: x.fine + delta,
      // con un nuovo orario il reminder già inviato non vale più
      ...(delta ? { reminderInviatoIl: undefined } : {}),
    });
    const pezzi = [
      delta ? `${cliente(x)} spostato alle ${hm(x.inizio + delta)}` : '',
      cambiaOp ? `${fasi[i].nome}${delta ? '' : ` di ${cliente(x)}`} → ${operatori.find((o) => o.id === dest)?.nome ?? 'da assegnare'}` : '',
    ];
    setEsito({
      testo: pezzi.filter(Boolean).join(' · '),
      avvisi: verifica({
        data: giorno,
        fasi: fasi.map((f) => ({ ...f, staffId: f.tipo === 'lavoro' ? f.staffId : null })),
        salone,
        operatori,
        impegni: impegniDa(lista, x.id),
      }),
      annulla: () => {
        db.appuntamenti.update(x.id!, prima);
        setEsito(null);
      },
    });
  }

  function aggiorna(x: number, y: number, testo: string, colore: string) {
    const p = presa.current;
    if (!p) return;
    // vicino ai bordi la griglia scorre, per raggiungere orari non visibili
    const scroll = document.querySelector('.griglia-scroll');
    if (scroll) {
      const r = scroll.getBoundingClientRect();
      if (y < r.top + 70) scroll.scrollTop -= 14;
      else if (y > r.bottom - 40) scroll.scrollTop += 14;
    }
    const f = p.a.fasi[p.i];
    let delta = Math.round((y - cimaColonne() - p.yRel0) / PX / imp.passo) * imp.passo;
    delta = Math.max(-p.a.inizio, Math.min(24 * 60 - p.a.fine, delta));
    const su = colonnaSotto(x) ?? f.staffId ?? 0;
    meta.current = { su, delta };
    setFantasma({ x, y, testo, colore, su, inizio: f.inizio + delta, durata: f.durata });
  }

  function muovi(e: PointerEvent<HTMLButtonElement>, testo: string, colore: string) {
    const p = presa.current;
    if (!p) return;
    if (!p.attivo) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 10) return;
      if (e.pointerType === 'touch') {
        // col dito il trascinamento parte solo dopo una pressione prolungata: questo è uno scorrimento
        clearTimeout(p.timer);
        presa.current = null;
        return;
      }
      p.attivo = true;
    }
    aggiorna(e.clientX, e.clientY, testo, colore);
  }
  function rilascia() {
    const p = presa.current;
    presa.current = null;
    setFantasma(null);
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.attivo) return;
    // il rilascio genera anche un click: non deve aprire l'appuntamento
    saltaClick.current = true;
    setTimeout(() => (saltaClick.current = false), 80);
    const { su, delta } = meta.current;
    const dest = su === 0 ? null : su;
    if (delta || dest !== p.a.fasi[p.i].staffId) sposta(p.a, p.i, dest, delta);
  }

  const blocchi = (staffId: number | null) =>
    lista.flatMap((x) =>
      x.fasi.map((f, i) => {
        if (f.staffId !== staffId || f.durata <= 0) return null;
        const colore = operatori.find((o) => o.id === staffId)?.colore ?? '#777';
        const mobile = f.tipo === 'lavoro';
        return (
          <button
            key={`${x.id}-${i}`}
            className={`blocco ${f.tipo} ${x.stato}${fantasma && presa.current?.a.id === x.id && presa.current?.i === i ? ' in-volo' : ''}`}
            style={{ top: (f.inizio - da) * PX, height: f.durata * PX - 2, ['--c' as string]: colore }}
            onPointerDown={(e) => {
              if (!mobile || e.button !== 0) return;
              const testo = `${cliente(x)} · ${f.nome}`;
              const { clientX, clientY } = e;
              presa.current = { a: x, i, x0: clientX, y0: clientY, yRel0: clientY - cimaColonne(), attivo: false, timer: 0 };
              if (e.pointerType === 'touch')
                presa.current.timer = window.setTimeout(() => {
                  if (!presa.current) return;
                  presa.current.attivo = true;
                  navigator.vibrate?.(25);
                  aggiorna(clientX, clientY, testo, colore);
                }, 350);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => muovi(e, `${cliente(x)} · ${f.nome}`, colore)}
            onPointerUp={rilascia}
            onPointerCancel={() => {
              clearTimeout(presa.current?.timer);
              presa.current = null;
              setFantasma(null);
            }}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              if (saltaClick.current) return;
              vai({ p: 'prenota', id: x.id });
            }}
          >
            <b>{cliente(x)}</b>
            <span>
              {f.tipo === 'posa' ? 'posa' : f.nome} · {hm(f.inizio)}–{hm(f.inizio + f.durata)}
            </span>
          </button>
        );
      }),
    );
  const bersaglio = (sid: number) => (fantasma?.su === sid ? ' bersaglio' : '');
  /** sagoma tratteggiata nel punto in cui la fase verrebbe rilasciata */
  const sagoma = (sid: number) =>
    fantasma?.su === sid && (
      <div className="sagoma" style={{ top: (fantasma.inizio - da) * PX, height: fantasma.durata * PX - 2 }}>
        {hm(fantasma.inizio)}–{hm(fantasma.inizio + fantasma.durata)}
      </div>
    );

  return (
    <div className="pagina agenda">
      {testata}
      {(!salone.length || ecc) && (
        <p className={salone.length ? 'nota' : 'avviso'}>
          {salone.length ? `Orario speciale: ${salone.map((f) => `${hm(f.da)}–${hm(f.a)}`).join(' · ')}` : 'Salone chiuso'}
          {ecc?.nota ? ` — ${ecc.nota}` : ''}
        </p>
      )}
      {!colonne.length && <p className="avviso">Nessun operatore attivo: aggiungine uno nella sezione Personale.</p>}
      <div className="griglia-scroll">
        <div className="griglia" style={{ gridTemplateColumns: `3.5rem repeat(${colonne.length + (senzaOp ? 1 : 0)}, minmax(10rem, 1fr))` }}>
          <div className="angolo" />
          {colonne.map((o) => (
            <div className="col-testa" key={o.id} style={{ borderColor: o.colore }}>
              {o.nome}
            </div>
          ))}
          {senzaOp && <div className="col-testa">Da assegnare</div>}

          <div className="col-ore" style={{ height: altezza }}>
            {ore.map((o) => (
              <span key={o} style={{ top: (o - da) * PX }}>
                {hm(o)}
              </span>
            ))}
          </div>
          {colonne.map((o) => (
            <div
              className={`col${bersaglio(o.id!)}`}
              key={o.id}
              data-staff={o.id}
              style={{ height: altezza, backgroundSize: `100% ${60 * PX}px` }}
              onClick={(e) => tocco(e, o.id)}
            >
              {buchi(turnoOperatore(o, giorno, salone), da, a).map((b) => (
                <div className="chiuso" key={b.da} style={{ top: (b.da - da) * PX, height: (b.a - b.da) * PX }} />
              ))}
              {blocchi(o.id!)}
              {sagoma(o.id!)}
              {giorno === oggi() && adesso > da && adesso < a && <div className="adesso" style={{ top: (adesso - da) * PX }} />}
            </div>
          ))}
          {senzaOp && (
            <div className={`col${bersaglio(0)}`} data-staff={0} style={{ height: altezza, backgroundSize: `100% ${60 * PX}px` }} onClick={(e) => tocco(e)}>
              {blocchi(null)}
              {sagoma(0)}
            </div>
          )}
        </div>
      </div>
      <p className="tenue legenda">
        Tocca uno spazio vuoto per prenotare a quell'ora, un appuntamento per modificarlo. <b>Trascina un blocco</b> (sul tablet: tieni
        premuto un attimo, poi sposta) in su o in giù per cambiare orario, su un'altra colonna per cambiare operatore. La colonnina tratteggiata a destra è la posa: in quel tempo l'operatore è libero.
      </p>
      {fantasma && (
        <div className="fantasma" style={{ left: fantasma.x, top: fantasma.y, background: fantasma.colore }}>
          {fantasma.testo} · {hm(fantasma.inizio)}
        </div>
      )}
      {esito && (
        <div className="esito" role="status">
          <div className="cresce">
            <strong>{esito.testo}</strong>
            {esito.avvisi.map((a) => (
              <div key={a}>⚠ {a}</div>
            ))}
          </div>
          <button onClick={esito.annulla}>Annulla</button>
          <button className="icona" aria-label="Chiudi" onClick={() => setEsito(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
