import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from '../db';
import type { Appuntamento } from '../types';
import { componiMessaggio } from '../lib/contatti';
import { parametriAppuntamento } from '../lib/messaggi';
import { inviaWhatsApp, modoApi } from '../lib/whatsapp';
import type { Cliente } from '../types';
import { dataLunga, hm, piuGiorni } from '../lib/tempo';
import { nomeCliente } from '../ui';
import { SceltaData } from '../scelte';

export default function Reminder({ predefinito }: { predefinito: string }) {
  const imp = useImpostazioni();
  const [data, setData] = useState(predefinito);
  const clienti = useLiveQuery(() => db.clienti.toArray(), []) ?? [];
  const lista = (useLiveQuery(() => db.appuntamenti.where('data').equals(data).toArray(), [data]) ?? [])
    .filter((a) => a.stato === 'prenotato')
    .sort((a, b) => a.inizio - b.inizio);

  const testo = (a: Appuntamento) =>
    componiMessaggio(imp.messaggio, {
      nome: clienti.find((c) => c.id === a.clientId)?.nome ?? '',
      data: dataLunga(a.data),
      ora: hm(a.inizio),
      servizio: [...new Set(a.fasi.map((f) => f.servizio))].join(', '),
      salone: imp.nomeSalone,
    });
  const segna = (a: Appuntamento, inviato: boolean) =>
    db.appuntamenti.update(a.id!, { reminderInviatoIl: inviato ? new Date().toISOString() : undefined });
  const api = modoApi(imp);
  const [inCorso, setInCorso] = useState<number | null>(null);
  const [errori, setErrori] = useState<Record<number, string>>({});

  // il tocco su "Invia" è la scelta dell'operatore: apre WhatsApp oppure invia direttamente
  async function invia(a: Appuntamento, c: Cliente) {
    setErrori((e) => ({ ...e, [a.id!]: '' }));
    setInCorso(a.id!);
    try {
      const ok = await inviaWhatsApp({ imp, tipo: 'reminder', numero: c.telefono, testo: testo(a), parametri: parametriAppuntamento(a, c, imp), a: nomeCliente(c) });
      if (ok) await segna(a, true);
    } catch (err) {
      setErrori((e) => ({ ...e, [a.id!]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setInCorso(null);
    }
  }

  const daInviare = lista.filter((a) => !a.reminderInviatoIl).length;
  return (
    <div className="pagina">
      <header className="testata">
        <h1>Reminder WhatsApp</h1>
        <span className="spazio" />
        <button onClick={() => setData(piuGiorni(data, -1))} aria-label="Giorno precedente">
          ‹
        </button>
        <SceltaData valore={data} onChange={setData} label="Appuntamenti del" />
        <button onClick={() => setData(piuGiorni(data, 1))} aria-label="Giorno successivo">
          ›
        </button>
        {data !== predefinito && <button onClick={() => setData(predefinito)}>Prossima apertura</button>}
      </header>
      <p className="nota">
        Appuntamenti di <b className="capitalizza">{dataLunga(data)}</b>
        {data === predefinito && ' (prossimo giorno di apertura)'}: {lista.length ? `${daInviare} da avvisare su ${lista.length}` : 'nessuno'}.
        {api ? (
          <> Toccando <b>Invia ora</b> il messaggio parte subito, senza aprire WhatsApp.</>
        ) : (
          <> Toccando <b>Invia</b> si apre WhatsApp con il messaggio già scritto: basta premere invio.</>
        )}
      </p>

      <div className="elenco">
        {lista.map((a) => {
          const c = clienti.find((x) => x.id === a.clientId);
          const inviato = !!a.reminderInviatoIl;
          return (
            <div key={a.id} className={`voce reminder${inviato ? ' fatto' : ''}`}>
              <div className="cresce">
                <strong>
                  {hm(a.inizio)} · {nomeCliente(c)}
                </strong>
                <span className="tenue"> {c?.telefono || 'senza numero'}</span>
                {!api && <p className="anteprima">{testo(a)}</p>}
                {errori[a.id!] && <p className="avviso">{errori[a.id!]}</p>}
              </div>
              {inviato ? (
                <div className="azioni">
                  <span className="etichetta verde">✓ inviato</span>
                  <button className="piccolo" onClick={() => segna(a, false)}>
                    Da reinviare
                  </button>
                </div>
              ) : c?.telefono ? (
                <button className="bottone whatsapp" disabled={inCorso === a.id} onClick={() => invia(a, c)}>
                  {inCorso === a.id ? 'Invio…' : api ? 'Invia ora' : 'Invia'}
                </button>
              ) : (
                <span className="etichetta gialla">manca il cellulare</span>
              )}
            </div>
          );
        })}
        {!lista.length && <p className="tenue">Nessun appuntamento prenotato in questa data.</p>}
      </div>
    </div>
  );
}
