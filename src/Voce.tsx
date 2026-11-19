// Comandi vocali: pulsante del microfono sempre visibile, riconoscimento della voce del dispositivo,
// interpretazione a frasi guidate (lib/voce) e risposta scritta e parlata.
// Le prenotazioni non vengono salvate da qui: si apre la prenotazione già compilata da confermare.
import { useEffect, useRef, useState } from 'react';
import { db, useImpostazioni } from './db';
import type { Rotta } from './App';
import type { Appuntamento, Cliente, Eccezione, Servizio } from './types';
import { ESEMPI, interpreta, type Comando } from './lib/voce';
import { fasceSalone, impegniDa, nelleFasce, primoSlot, trovaSlot, turnoOperatore } from './lib/slots';
import { dataLunga, hm, oggi, oraMinuti, piuGiorni } from './lib/tempo';
import { linkWhatsApp } from './lib/contatti';
import { serviziDi, testoRicetta } from './lib/messaggi';
import { nomeCliente } from './ui';

interface Riga {
  testo: string;
  azione?: () => void;
}
interface Risposta {
  /** testo mostrato e letto ad alta voce */
  detto: string;
  righe?: Riga[];
  pulsanti?: { etichetta: string; azione: () => void; link?: string }[];
}

type Riconoscitore = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
const Riconoscimento = (): (new () => Riconoscitore) | undefined =>
  (window as unknown as { SpeechRecognition?: new () => Riconoscitore; webkitSpeechRecognition?: new () => Riconoscitore })
    .SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Riconoscitore }).webkitSpeechRecognition;

/** Numero leggibile a voce: senza +39 e a gruppi ("333 123 4567"). */
const numeroDaDire = (t: string) => t.replace(/^\+39/, '').replace(/^(\d{3})(\d{3})(\d+)$/, '$1 $2 $3');

function parla(testo: string) {
  try {
    if (localStorage.getItem('voce-muta') === '1' || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    // orari detti in modo naturale: "09:00" → "9", "10:30" → "10 e 30"
    const naturale = testo
      .replace(/(\d+) g\b/g, '$1 grammi')
      .replace(/\b0?(\d{1,2}):00\b/g, '$1')
      .replace(/\b0?(\d{1,2}):(\d{2})\b/g, '$1 e $2');
    const u = new SpeechSynthesisUtterance(naturale);
    u.lang = 'it-IT';
    speechSynthesis.speak(u);
  } catch {
    /* lettura ad alta voce non disponibile */
  }
}

export default function Voce(p: { vai: (r: Rotta) => void; vaiAgenda: (data: string) => void }) {
  const imp = useImpostazioni();
  const [aperto, setAperto] = useState(false);
  const [ascolto, setAscolto] = useState(false);
  const [sentito, setSentito] = useState('');
  const [scritto, setScritto] = useState('');
  const [risposta, setRisposta] = useState<Risposta | null>(null);
  const [muta, setMuta] = useState(() => {
    try {
      return localStorage.getItem('voce-muta') === '1';
    } catch {
      return false;
    }
  });
  const ric = useRef<Riconoscitore | null>(null);
  const supportato = !!Riconoscimento();

  useEffect(() => () => ric.current?.stop(), []);

  const rispondi = (r: Risposta) => {
    setRisposta(r);
    parla(r.detto);
  };

  /** Esegue il comando: risponde, oppure porta alla pagina giusta. */
  async function esegui(frase: string) {
    setSentito(frase);
    const [clienti, servizi, operatori, eccezioni] = await Promise.all([
      db.clienti.toArray(),
      db.servizi.toArray(),
      db.operatori.toArray(),
      db.eccezioni.toArray(),
    ]);
    const c = interpreta(frase, { oggi: oggi(), clienti, servizi, operatori, fasce: imp.fasceOrarie ?? [] });
    const nomeOp = (id?: number | null) => operatori.find((o) => o.id === id)?.nome;
    const scegliCliente = (lista: Cliente[], comando: (cl: Cliente) => string) =>
      rispondi({
        detto: `Ho trovato ${lista.length} clienti: ${lista.map(nomeCliente).join(', ')}. Quale?`,
        righe: lista.map((cl) => ({ testo: `${nomeCliente(cl)}${cl.telefono ? ` · ${cl.telefono}` : ''}`, azione: () => esegui(comando(cl)) })),
      });
    const unSoloCliente = (lista: Cliente[], comando: (cl: Cliente) => string): Cliente | null => {
      if (!lista.length) {
        rispondi({ detto: 'Non ho capito di quale cliente si tratta. Di’ nome e cognome come sono in rubrica.' });
        return null;
      }
      if (lista.length > 1) {
        scegliCliente(lista, comando);
        return null;
      }
      return lista[0];
    };

    switch (c.tipo) {
      case 'aiuto':
        return rispondi({ detto: 'Ecco alcuni esempi di cosa puoi dire.', righe: ESEMPI.map((e) => ({ testo: `“${e}”`, azione: () => esegui(e) })) });

      case 'apri': {
        p.vai({ p: c.pagina });
        setAperto(false);
        return parla(`Apro ${c.pagina === 'impostazioni' ? 'le impostazioni' : c.pagina}`);
      }

      case 'agenda': {
        const lista = (await db.appuntamenti.where('data').equals(c.data).toArray())
          .filter((a) => (a.stato === 'prenotato' || a.stato === 'completato') && (!c.staffId || a.fasi.some((f) => f.staffId === c.staffId)))
          .sort((a, b) => a.inizio - b.inizio);
        const chi = (a: Appuntamento) => nomeCliente(clienti.find((x) => x.id === a.clientId));
        const op = c.staffId ? ` per ${nomeOp(c.staffId)}` : '';
        const quanti = lista.length === 1 ? 'un appuntamento' : `${lista.length} appuntamenti`;
        return rispondi({
          detto: lista.length
            ? `${dataLunga(c.data)}${op}: ${quanti}. ${lista
                .slice(0, 5)
                .map((a) => `Alle ${hm(a.inizio)} ${chi(a)}, ${serviziDi(a)}`)
                .join('. ')}${lista.length > 5 ? `. E altri ${lista.length - 5}.` : '.'}`
            : `${dataLunga(c.data)}${op}: nessun appuntamento.`,
          righe: lista.map((a) => ({ testo: `${hm(a.inizio)} · ${chi(a)} · ${serviziDi(a)}`, azione: () => p.vai({ p: 'prenota', id: a.id }) })),
          pulsanti: [{ etichetta: 'Apri in agenda', azione: () => (p.vaiAgenda(c.data), setAperto(false)) }],
        });
      }

      case 'telefono': {
        const cl = unSoloCliente(c.clienti, (x) => `telefono di ${x.nome} ${x.cognome}`);
        if (!cl) return;
        if (!cl.telefono) return rispondi({ detto: `${nomeCliente(cl)} non ha un numero in rubrica.` });
        return rispondi({
          detto: `Il numero di ${nomeCliente(cl)} è ${numeroDaDire(cl.telefono)}.`,
          pulsanti: [
            { etichetta: 'Chiama', azione: () => {}, link: `tel:${cl.telefono}` },
            { etichetta: 'WhatsApp', azione: () => {}, link: linkWhatsApp(cl.telefono) },
          ],
        });
      }

      case 'scheda': {
        const cl = unSoloCliente(c.clienti, (x) => `scheda colore di ${x.nome} ${x.cognome}`);
        if (!cl) return;
        const schede = (await db.schede.where('clientId').equals(cl.id!).toArray()).sort((a, b) => b.data.localeCompare(a.data));
        if (!schede.length) return rispondi({ detto: `Non ci sono schede colore per ${nomeCliente(cl)}.` });
        const s = schede[0];
        return rispondi({
          detto: `Ultima scheda colore di ${nomeCliente(cl)}, ${dataLunga(s.data)}: ${testoRicetta(s) || 'scheda vuota'}.${s.note ? ` Note: ${s.note}.` : ''}`,
          righe: schede.slice(1, 4).map((x) => ({ testo: `Prima: ${x.data.split('-').reverse().join('/')} · ${testoRicetta(x)}` })),
        });
      }

      case 'prossimo':
      case 'ultimo': {
        const cl = unSoloCliente(c.clienti, (x) => `${c.tipo === 'prossimo' ? 'prossimo appuntamento' : 'ultima volta'} di ${x.nome} ${x.cognome}`);
        if (!cl) return;
        const adesso = oraMinuti();
        const tutti = (await db.appuntamenti.where('clientId').equals(cl.id!).toArray()).filter((a) => a.stato !== 'annullato');
        const futuro = (a: Appuntamento) => a.data > oggi() || (a.data === oggi() && a.inizio >= adesso);
        const lista =
          c.tipo === 'prossimo'
            ? tutti.filter((a) => futuro(a) && a.stato === 'prenotato').sort((a, b) => a.data.localeCompare(b.data) || a.inizio - b.inizio)
            : tutti.filter((a) => !futuro(a) && a.stato !== 'assente').sort((a, b) => b.data.localeCompare(a.data) || b.inizio - a.inizio);
        if (!lista.length)
          return rispondi({ detto: c.tipo === 'prossimo' ? `${nomeCliente(cl)} non ha appuntamenti in programma.` : `${nomeCliente(cl)} non è ancora mai venuta.` });
        const a = lista[0];
        const quando = `${dataLunga(a.data)} alle ${hm(a.inizio)}, ${serviziDi(a)}`;
        return rispondi({
          detto:
            c.tipo === 'prossimo'
              ? `Il prossimo appuntamento di ${nomeCliente(cl)} è ${quando}.${lista.length > 1 ? ` Ne ha altri ${lista.length - 1}.` : ''}`
              : `L'ultima volta di ${nomeCliente(cl)} è stata ${quando}.`,
          righe: lista.slice(0, 6).map((x) => ({ testo: `${x.data.split('-').reverse().join('/')} ${hm(x.inizio)} · ${serviziDi(x)}`, azione: () => p.vai({ p: 'prenota', id: x.id }) })),
        });
      }

      case 'libero': {
        if (!c.serviceIds.length) return rispondi({ detto: 'Per quale servizio? Ad esempio: primo libero per colore base.' });
        const scelti = c.serviceIds.map((id) => servizi.find((s) => s.id === id)!).filter(Boolean) as Servizio[];
        const fasi = scelti.flatMap((s) => s.fasi.map((f) => ({ tipo: f.tipo, durata: f.durata, competenza: f.competenza })));
        const fino = piuGiorni(c.dal, 60);
        const futuri = await db.appuntamenti.where('data').between(c.dal, fino, true, true).toArray();
        for (let i = 0; i <= 60; i++) {
          const g = piuGiorni(c.dal, i);
          const salone = fasceSalone(g, imp.settimana, eccezioni);
          const slot = trovaSlot({
            fasi,
            salone,
            operatori: operatori.filter((o) => o.attivo).map((o) => ({ id: o.id!, turno: turnoOperatore(o, g, salone), competenze: o.competenze })),
            impegni: impegniDa(futuri.filter((a) => a.data === g)),
            passo: imp.passo,
            nonPrimaDi: g === oggi() ? oraMinuti() : 0,
          }).filter((s) => (!c.staffId || s.staff.includes(c.staffId)) && nelleFasce(s.inizio, c.fascia ? [c.fascia] : []));
          const primo = primoSlot(slot);
          if (primo) {
            const staff = primo.staff.find((x) => x != null) ?? undefined;
            const con = [...new Set(primo.staff.filter((x) => x != null))].map(nomeOp).join(' e ');
            return rispondi({
              detto: `Il primo posto per ${scelti.map((s) => s.nome).join(' e ')}${c.fascia ? ` di ${c.fascia.nome.toLowerCase()}` : ''} è ${dataLunga(g)} alle ${hm(primo.inizio)} con ${con}.`,
              pulsanti: [
                {
                  etichetta: 'Prenota questo',
                  azione: () => {
                    p.vai({ p: 'prenota', pre: { data: g, inizio: primo.inizio, staffId: staff, staff: primo.staff, serviceIds: c.serviceIds } });
                    setAperto(false);
                  },
                },
              ],
            });
          }
        }
        return rispondi({ detto: 'Non ho trovato posti liberi nei prossimi due mesi con questi criteri.' });
      }

      case 'prenota':
        return prepara(c, clienti, servizi, operatori, eccezioni);

      default:
        return rispondi({
          detto: 'Non ho capito. Prova ad esempio: appuntamenti di domani, oppure di’ aiuto.',
          righe: ESEMPI.slice(0, 4).map((e) => ({ testo: `“${e}”`, azione: () => esegui(e) })),
        });
    }
  }

  /** Prenotazione a voce: apre "Nuovo appuntamento" già compilato, da controllare e confermare. */
  async function prepara(
    c: Extract<Comando, { tipo: 'prenota' }>,
    clienti: Cliente[],
    servizi: Servizio[],
    operatori: { id?: number; nome: string }[],
    eccezioni: Eccezione[],
  ) {
    if (c.clienti.length > 1) {
      return rispondi({
        detto: `Ho trovato ${c.clienti.length} clienti: ${c.clienti.map(nomeCliente).join(', ')}. Per chi è l'appuntamento?`,
        righe: c.clienti.map((cl) => ({ testo: nomeCliente(cl), azione: () => prepara({ ...c, clienti: [cl] }, clienti, servizi, operatori, eccezioni) })),
      });
    }
    const cl = c.clienti[0];
    // se è detta l'ora ma non l'operatore, propone chi è libero a quell'ora con la skill giusta
    let staffId = c.staffId;
    let staffFasi: (number | null)[] | undefined;
    let nessunoLibero = false;
    if (!staffId && c.data && c.inizio != null && c.serviceIds.length) {
      const fasi = c.serviceIds.flatMap((id) => servizi.find((s) => s.id === id)?.fasi.map((f) => ({ tipo: f.tipo, durata: f.durata, competenza: f.competenza })) ?? []);
      const salone = fasceSalone(c.data, imp.settimana, eccezioni);
      const ops = (await db.operatori.toArray()).filter((o) => o.attivo);
      const slot = trovaSlot({
        fasi,
        salone,
        operatori: ops.map((o) => ({ id: o.id!, turno: turnoOperatore(o, c.data!, salone), competenze: o.competenze })),
        impegni: impegniDa(await db.appuntamenti.where('data').equals(c.data).toArray()),
        passo: 5,
      }).find((s) => s.inizio === c.inizio);
      staffId = slot?.staff.find((x) => x != null) ?? undefined;
      staffFasi = slot?.staff;
      nessunoLibero = !slot;
    }
    const parti = [
      c.serviceIds.map((id) => servizi.find((s) => s.id === id)?.nome).filter(Boolean).join(' e ') || 'appuntamento',
      cl ? `per ${nomeCliente(cl)}` : '',
      c.data ? dataLunga(c.data) : '',
      c.inizio != null ? `alle ${hm(c.inizio)}` : '',
      staffId ? `con ${operatori.find((o) => o.id === staffId)?.nome}` : '',
    ].filter(Boolean);
    const manca = [!cl && 'il cliente', !c.serviceIds.length && 'il servizio', !c.data && 'il giorno', c.inizio == null && "l'ora"].filter(Boolean);
    p.vai({
      p: 'prenota',
      pre: { clientId: cl?.id, serviceIds: c.serviceIds, data: c.data, inizio: c.inizio, staffId, staff: staffFasi, cerca: cl ? undefined : c.nomeSentito },
    });
    setAperto(false);
    parla(
      `Ho preparato: ${parti.join(' ')}.${manca.length ? ` Manca ${manca.join(', ')}.` : ''}${!cl && c.nomeSentito ? ` Non trovo ${c.nomeSentito} in rubrica.` : ''}${nessunoLibero ? ' Attenzione: a quell’ora non c’è un operatore libero con la skill giusta.' : ''} Controlla e conferma.`,
    );
  }

  // ultimo testo sentito e se è già stato eseguito (per non perderlo né eseguirlo due volte)
  const ultimoSentito = useRef('');
  const eseguito = useRef(false);
  const limite = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function ascolta() {
    const R = Riconoscimento();
    if (!R) return;
    // secondo tocco mentre ascolta: ferma (il testo sentito fin lì viene eseguito in onend)
    if (ascolto && ric.current) {
      ric.current.stop();
      return;
    }
    // chiude un eventuale riconoscimento rimasto aperto da prima
    try {
      (ric.current as unknown as { abort?: () => void } | null)?.abort?.();
    } catch {
      /* niente */
    }
    try {
      speechSynthesis?.cancel();
    } catch {
      /* niente */
    }
    const r = new R();
    r.lang = 'it-IT';
    r.interimResults = true;
    r.maxAlternatives = 1;
    ultimoSentito.current = '';
    eseguito.current = false;
    r.onresult = (e) => {
      if (ric.current !== r) return;
      // solo l'ultimo risultato: su Android i pezzi precedenti ripetono la frase
      const ultimo = e.results[e.results.length - 1];
      const testo = ultimo[0].transcript.trim();
      ultimoSentito.current = testo;
      setSentito(testo);
      if (ultimo.isFinal && !eseguito.current) {
        eseguito.current = true;
        r.stop();
        void esegui(testo);
      }
    };
    r.onerror = (e) => {
      if (ric.current !== r || e.error === 'aborted') return;
      const msg: Record<string, string> = {
        'not-allowed': 'Il microfono non è autorizzato: consenti l’accesso al microfono nelle impostazioni del browser.',
        'no-speech': 'Non ho sentito nulla. Tocca il microfono e parla.',
        network: 'Per riconoscere la voce serve internet.',
        'audio-capture': 'Microfono non disponibile.',
      };
      eseguito.current = true;
      setRisposta({ detto: msg[e.error] ?? `Riconoscimento vocale non riuscito (${e.error}).` });
    };
    r.onend = () => {
      clearTimeout(limite.current);
      if (ric.current !== r) return;
      setAscolto(false);
      ric.current = null;
      // il dispositivo ha chiuso senza segnare il risultato come definitivo: si usa l'ultimo sentito
      if (!eseguito.current && ultimoSentito.current) {
        eseguito.current = true;
        void esegui(ultimoSentito.current);
      }
    };
    ric.current = r;
    setRisposta(null);
    setSentito('');
    setAscolto(true);
    try {
      r.start();
    } catch {
      // il microfono non era ancora libero: si riprova tra un attimo
      setTimeout(() => {
        try {
          r.start();
        } catch {
          setAscolto(false);
          setRisposta({ detto: 'Il microfono è occupato: riprova tra qualche secondo.' });
        }
      }, 400);
    }
    // non resta mai in ascolto all'infinito
    clearTimeout(limite.current);
    limite.current = setTimeout(() => r.stop(), 15000);
  }

  return (
    <>
      <button
        className={`microfono${ascolto ? ' in-ascolto' : ''}`}
        aria-label="Comandi vocali"
        title="Comandi vocali"
        onClick={() => {
          // ogni tocco del microfono ascolta un nuovo comando (o ferma l'ascolto in corso)
          setAperto(true);
          if (supportato) ascolta();
        }}
      >
        🎤
      </button>
      {aperto && (
        <div className="voce-pannello" role="dialog" aria-label="Comandi vocali">
          <header>
            <strong>Comandi vocali</strong>
            <span className="spazio" />
            <label className="spunta piccola">
              <input
                type="checkbox"
                checked={!muta}
                onChange={(e) => {
                  setMuta(!e.target.checked);
                  try {
                    localStorage.setItem('voce-muta', e.target.checked ? '0' : '1');
                  } catch {
                    /* preferenza non salvata */
                  }
                }}
              />
              risposta a voce
            </label>
            <button
              className="icona"
              aria-label="Chiudi"
              onClick={() => {
                ric.current?.stop();
                setAperto(false);
              }}
            >
              ✕
            </button>
          </header>
          {supportato ? (
            <button className={`primario grande ascolta${ascolto ? ' in-ascolto' : ''}`} onClick={ascolta}>
              {ascolto ? '● Ti ascolto… (tocca per fermare)' : '🎤 Tocca e parla'}
            </button>
          ) : (
            <p className="avviso">Il riconoscimento vocale non è disponibile in questo browser: puoi scrivere il comando qui sotto.</p>
          )}
          <form
            className="riga"
            onSubmit={(e) => {
              e.preventDefault();
              if (scritto.trim()) void esegui(scritto.trim());
              setScritto('');
            }}
          >
            <input className="cresce" placeholder="…oppure scrivi il comando" value={scritto} onChange={(e) => setScritto(e.target.value)} aria-label="Comando scritto" />
            <button type="submit">Vai</button>
          </form>
          {sentito && <p className="sentito">“{sentito}”</p>}
          {risposta && (
            <div className="risposta">
              <p>{risposta.detto}</p>
              {risposta.righe?.map((r, i) =>
                r.azione ? (
                  <button key={i} className="voce riga-risposta" onClick={r.azione}>
                    {r.testo}
                  </button>
                ) : (
                  <p key={i} className="tenue">
                    {r.testo}
                  </p>
                ),
              )}
              {!!risposta.pulsanti?.length && (
                <div className="riga a-capo">
                  {risposta.pulsanti.map((b) =>
                    b.link ? (
                      <a key={b.etichetta} className="bottone" href={b.link} target="_blank" rel="noreferrer">
                        {b.etichetta}
                      </a>
                    ) : (
                      <button key={b.etichetta} className="primario" onClick={b.azione}>
                        {b.etichetta}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          )}
          {!sentito && !risposta && (
            <p className="tenue">
              Esempi: “appuntamenti di domani”, “primo libero per colore base”, “prenota piega per Maria Rossi giovedì alle 10”. Di’ “aiuto” per
              altri.
            </p>
          )}
        </div>
      )}
    </>
  );
}
