import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from './db';
import { prossimaApertura } from './lib/slots';
import { passaFiltroDurata } from './lib/messaggi';
import { oggi } from './lib/tempo';
import Agenda from './pages/Agenda';
import Prenota, { type Pre } from './pages/Prenota';
import Clienti from './pages/Clienti';
import Servizi from './pages/Servizi';
import Personale from './pages/Personale';
import Orari from './pages/Orari';
import Reminder from './pages/Reminder';
import Impostazioni from './pages/Impostazioni';
import Colori from './pages/Colori';
import Cartacea from './pages/Cartacea';
import Statistiche from './pages/Statistiche';
import BackupAutomatico from './BackupAutomatico';
import Voce from './Voce';
import { CONTROLLO_OGNI, collegaDispositivo, leggiCollegamento, sincronizza } from './sincronizza';
import { Modale } from './ui';
import { hm } from './lib/tempo';

type Pagina = 'agenda' | 'reminder' | 'colori' | 'cartacea' | 'statistiche' | 'clienti' | 'servizi' | 'personale' | 'orari' | 'impostazioni';
/** `da`: pagina a cui tornare dopo la prenotazione (di base l'agenda) */
export type Rotta = { p: Pagina } | { p: 'prenota'; id?: number; pre?: Pre; da?: Pagina };

const VOCI: [Pagina, string, string][] = [
  ['agenda', 'Agenda', '📅'],
  ['reminder', 'Reminder', '💬'],
  ['colori', 'Colori', '🎨'],
  ['cartacea', 'Carta', '📄'],
  ['clienti', 'Clienti', '👥'],
  ['servizi', 'Servizi', '✂️'],
  ['personale', 'Personale', '🧑'],
  ['orari', 'Orari', '🕒'],
  ['statistiche', 'Statistiche', '📊'],
  ['impostazioni', 'Altro', '⚙️'],
];

export default function App() {
  const [rotta, setRotta] = useState<Rotta>({ p: 'agenda' });
  const [magazzino, setMagazzino] = useState(location.hash === '#magazzino');
  // link "#collega=…" aperto su un nuovo dispositivo: propone di collegarlo ai dati del salone
  const [collega, setCollega] = useState(() => leggiCollegamento(location.hash));
  const [esitoCollega, setEsitoCollega] = useState('');
  const togliHash = () => history.replaceState(null, '', location.pathname + location.search);
  useEffect(() => {
    const cambio = () => setMagazzino(location.hash === '#magazzino');
    window.addEventListener('hashchange', cambio);
    return () => window.removeEventListener('hashchange', cambio);
  }, []);
  const [giorno, setGiorno] = useState(oggi());
  const imp = useImpostazioni();
  const eccezioni = useLiveQuery(() => db.eccezioni.toArray(), []) ?? [];
  const giornoReminder = prossimaApertura(oggi(), imp.settimana, eccezioni);
  const daInviare =
    useLiveQuery(
      () =>
        db.appuntamenti
          .where('data')
          .equals(giornoReminder)
          .filter((a) => a.stato === 'prenotato' && !a.reminderInviatoIl && passaFiltroDurata(a, imp.reminderFiltro))
          .count(),
      [giornoReminder, imp.reminderFiltro?.verso, imp.reminderFiltro?.minuti],
    ) ?? 0;

  // dimensione di testo e controlli in tutta l'app
  useEffect(() => {
    document.documentElement.style.setProperty('--scala', String(imp.scalaTesto ?? 1.2));
  }, [imp.scalaTesto]);

  // chiede ad Android di non cancellare i dati locali quando lo spazio scarseggia
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

  // stessi dati su più dispositivi: all'avvio, ogni 2 minuti, al ritorno in primo piano e quando torna la rete
  useEffect(() => {
    if (!imp.syncAttiva) return;
    const vai = () => void sincronizza();
    const visibile = () => document.visibilityState === 'visible' && vai();
    vai();
    const t = setInterval(vai, CONTROLLO_OGNI);
    document.addEventListener('visibilitychange', visibile);
    window.addEventListener('online', vai);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', visibile);
      window.removeEventListener('online', vai);
    };
  }, [imp.syncAttiva]);

  // vista dedicata alla postazione del magazzino: solo la preparazione colori, a tutto schermo
  if (magazzino)
    return (
      <main className="solo">
        <Colori magazzino />
      </main>
    );

  const attiva = rotta.p === 'prenota' ? 'agenda' : rotta.p;
  return (
    <div className="app">
      <nav className="menu">
        <div className="marchio">
          {imp.nomeSalone}
          {imp.syncAttiva && (
            <span className={`sync-stato${imp.syncErrore ? ' errore' : ''}`} title={imp.syncErrore || 'Dati condivisi con gli altri dispositivi'}>
              {imp.syncErrore
                ? '⚠ non sincronizzato'
                : imp.syncUltima
                  ? `☁ ${hm(new Date(imp.syncUltima).getHours() * 60 + new Date(imp.syncUltima).getMinutes())}`
                  : '☁ …'}
            </span>
          )}
        </div>
        {VOCI.filter(([p]) => p !== 'cartacea' || imp.funzioni?.cartacea).map(([p, nome, icona]) => (
          <button key={p} className={attiva === p ? 'attiva' : ''} onClick={() => setRotta({ p })}>
            <span className="ico">{icona}</span>
            <span>{nome}</span>
            {p === 'reminder' && daInviare > 0 && <b className="badge">{daInviare}</b>}
          </button>
        ))}
      </nav>
      <main>
        {rotta.p === 'agenda' && <Agenda giorno={giorno} setGiorno={setGiorno} vai={setRotta} />}
        {rotta.p === 'prenota' && (
          <Prenota
            key={rotta.id ?? 'nuovo'}
            id={rotta.id}
            pre={rotta.pre}
            indietro={rotta.da === 'cartacea' ? 'Carta' : rotta.da === 'statistiche' ? 'Statistiche' : undefined}
            onFine={(data) => {
              if (data) setGiorno(data);
              setRotta({ p: rotta.da ?? 'agenda' });
            }}
          />
        )}
        {rotta.p === 'reminder' && <Reminder predefinito={giornoReminder} />}
        {rotta.p === 'clienti' && <Clienti vai={setRotta} />}
        {rotta.p === 'servizi' && <Servizi />}
        {rotta.p === 'personale' && <Personale />}
        {rotta.p === 'orari' && <Orari />}
        {rotta.p === 'colori' && <Colori />}
        {rotta.p === 'cartacea' && <Cartacea vai={setRotta} giornoIniziale={giorno} />}
        {rotta.p === 'statistiche' && <Statistiche vai={setRotta} />}
        {rotta.p === 'impostazioni' && <Impostazioni />}
      </main>
      {/* backup automatico su Drive e promemoria del backup manuale */}
      <BackupAutomatico />
      {/* comandi vocali: microfono sempre a portata di mano */}
      <Voce
        vai={setRotta}
        vaiAgenda={(d) => {
          setGiorno(d);
          setRotta({ p: 'agenda' });
        }}
      />
      {collega && (
        <Modale
          titolo="Collegare questo dispositivo?"
          onChiudi={() => {
            setCollega(null);
            togliHash();
          }}
          azioni={
            <>
              <button
                onClick={() => {
                  setCollega(null);
                  togliHash();
                }}
              >
                Annulla
              </button>
              <span className="spazio" />
              <button
                className="primario"
                disabled={esitoCollega === 'invio'}
                onClick={async () => {
                  setEsitoCollega('invio');
                  await collegaDispositivo(collega);
                  togliHash();
                  setCollega(null);
                  setEsitoCollega('');
                }}
              >
                {esitoCollega === 'invio' ? 'Collegamento…' : 'Collega e scarica i dati'}
              </button>
            </>
          }
        >
          <p>
            Questo dispositivo userà gli stessi dati del salone (agenda, clienti, servizi, personale, orari) salvati su Google Drive
            {collega.e ? ` di ${collega.e}` : ''}.
          </p>
          <p className="avviso">I dati presenti ora su questo dispositivo verranno sostituiti da quelli condivisi.</p>
          <p className="tenue">Dopo il collegamento le modifiche fatte qui o sugli altri dispositivi arrivano ovunque entro un paio di minuti.</p>
        </Modale>
      )}
    </div>
  );
}
