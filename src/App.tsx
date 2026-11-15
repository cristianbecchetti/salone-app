import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, useImpostazioni } from './db';
import { prossimaApertura } from './lib/slots';
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

type Pagina = 'agenda' | 'reminder' | 'colori' | 'clienti' | 'servizi' | 'personale' | 'orari' | 'impostazioni';
export type Rotta = { p: Pagina } | { p: 'prenota'; id?: number; pre?: Pre };

const VOCI: [Pagina, string, string][] = [
  ['agenda', 'Agenda', '📅'],
  ['reminder', 'Reminder', '💬'],
  ['colori', 'Colori', '🎨'],
  ['clienti', 'Clienti', '👥'],
  ['servizi', 'Servizi', '✂️'],
  ['personale', 'Personale', '🧑'],
  ['orari', 'Orari', '🕒'],
  ['impostazioni', 'Altro', '⚙️'],
];

export default function App() {
  const [rotta, setRotta] = useState<Rotta>({ p: 'agenda' });
  const [magazzino, setMagazzino] = useState(location.hash === '#magazzino');
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
          .filter((a) => a.stato === 'prenotato' && !a.reminderInviatoIl)
          .count(),
      [giornoReminder],
    ) ?? 0;

  // dimensione di testo e controlli in tutta l'app
  useEffect(() => {
    document.documentElement.style.setProperty('--scala', String(imp.scalaTesto ?? 1.2));
  }, [imp.scalaTesto]);

  // chiede ad Android di non cancellare i dati locali quando lo spazio scarseggia
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
  }, []);

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
        <div className="marchio">{imp.nomeSalone}</div>
        {VOCI.map(([p, nome, icona]) => (
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
            onFine={(data) => {
              if (data) setGiorno(data);
              setRotta({ p: 'agenda' });
            }}
          />
        )}
        {rotta.p === 'reminder' && <Reminder predefinito={giornoReminder} />}
        {rotta.p === 'clienti' && <Clienti vai={setRotta} />}
        {rotta.p === 'servizi' && <Servizi />}
        {rotta.p === 'personale' && <Personale />}
        {rotta.p === 'orari' && <Orari />}
        {rotta.p === 'colori' && <Colori />}
        {rotta.p === 'impostazioni' && <Impostazioni />}
      </main>
    </div>
  );
}
