import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, esportaTutto, ripristina, useImpostazioni } from '../db';
import type { Impostazioni as Imp } from '../types';
import { componiMessaggio } from '../lib/contatti';
import { dataLunga, oggi, piuGiorni } from '../lib/tempo';
import { Campo } from '../ui';

export default function Impostazioni() {
  const imp = useImpostazioni();
  const [msg, setMsg] = useState('');
  const [protetti, setProtetti] = useState<boolean | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const conteggi = useLiveQuery(async () => ({ clienti: await db.clienti.count(), appuntamenti: await db.appuntamenti.count() }), []);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setProtetti).catch(() => {});
  }, []);

  const salva = (pezzo: Partial<Imp>) => db.impostazioni.put({ ...imp, ...pezzo });

  async function esporta() {
    const nome = `salone-backup-${oggi()}.json`;
    const blob = new Blob([JSON.stringify(await esportaTutto())], { type: 'application/json' });
    const f = new File([blob], nome, { type: 'application/json' });
    // sul tablet apre "Condividi" (Drive, e-mail…); altrimenti scarica il file
    if (navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f], title: 'Backup salone' });
        setMsg('Backup condiviso.');
        return;
      } catch {
        /* condivisione annullata: si passa al download */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`Backup salvato come ${nome} nei download.`);
  }

  async function importa(f?: File) {
    if (!f) return;
    try {
      const backup = JSON.parse(await f.text());
      if (confirm('Ripristinare il backup? Tutti i dati attuali di questa app verranno sostituiti.')) {
        await ripristina(backup);
        setMsg('Backup ripristinato.');
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'File non valido.');
    }
    if (file.current) file.current.value = '';
  }

  const esempio = componiMessaggio(imp.messaggio, {
    nome: 'Maria',
    data: dataLunga(piuGiorni(oggi(), 1)),
    ora: '10:30',
    servizio: 'Colore base',
    salone: imp.nomeSalone,
  });

  return (
    <div className="pagina">
      <header className="testata">
        <h1>Impostazioni</h1>
      </header>
      {msg && <p className="nota">{msg}</p>}

      <section className="scheda">
        <h3>Salone</h3>
        <div className="griglia-form due">
          <Campo etichetta="Nome del salone">
            <input value={imp.nomeSalone} onChange={(e) => salva({ nomeSalone: e.target.value })} />
          </Campo>
          <Campo etichetta="Prefisso telefonico predefinito">
            <input value={imp.prefisso} inputMode="tel" onChange={(e) => salva({ prefisso: e.target.value.trim() })} />
          </Campo>
          <Campo etichetta="Dimensione testo e pulsanti">
            <select value={imp.scalaTesto ?? 1.2} onChange={(e) => salva({ scalaTesto: Number(e.target.value) })}>
              <option value={1}>Normale</option>
              <option value={1.2}>Grande</option>
              <option value={1.4}>Molto grande</option>
            </select>
          </Campo>
          <Campo etichetta="Slot proposti ogni">
            <select value={imp.passo} onChange={(e) => salva({ passo: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30].map((m) => (
                <option key={m} value={m}>
                  {m} minuti
                </option>
              ))}
            </select>
          </Campo>
        </div>
      </section>

      <section className="scheda">
        <h3>Messaggio di reminder</h3>
        <Campo etichetta="Testo" nota="Segnaposto: {nome} {data} {ora} {servizio} {salone}">
          <textarea rows={4} value={imp.messaggio} onChange={(e) => salva({ messaggio: e.target.value })} />
        </Campo>
        <p className="anteprima">{esempio}</p>
      </section>

      <section className="scheda">
        <h3>Conferma della prenotazione</h3>
        <p className="tenue">Proposta alla conferma dell'appuntamento per i servizi che la prevedono (impostazione in Servizi).</p>
        <Campo etichetta="Testo" nota="Segnaposto: {nome} {data} {ora} {servizio} {salone}">
          <textarea rows={3} value={imp.messaggioConferma} onChange={(e) => salva({ messaggioConferma: e.target.value })} />
        </Campo>
      </section>

      <section className="scheda">
        <h3>Riepilogo appuntamenti del mese</h3>
        <p className="tenue">Si invia dalla scheda cliente, scheda Appuntamenti. Sotto questa frase l'app elenca giorno, ora e servizi.</p>
        <Campo etichetta="Frase iniziale" nota="Segnaposto: {nome} {mese} {salone}">
          <textarea rows={2} value={imp.messaggioMese} onChange={(e) => salva({ messaggioMese: e.target.value })} />
        </Campo>
      </section>

      <section className="scheda">
        <h3>Magazzino</h3>
        <Campo etichetta="Numero WhatsApp del magazzino" nota="Usato da 'Invia al magazzino' nella pagina Colori. Vuoto = WhatsApp chiede a chi inviare.">
          <input inputMode="tel" value={imp.numeroMagazzino} onChange={(e) => salva({ numeroMagazzino: e.target.value })} />
        </Campo>
        <p className="tenue">
          Vista a schermo intero della sola preparazione colori: aggiungi <b>#magazzino</b> in fondo all'indirizzo dell'app.
        </p>
      </section>

      <section className="scheda">
        <h3>Backup dei dati</h3>
        <p className="tenue">
          I dati ({conteggi?.clienti ?? 0} clienti, {conteggi?.appuntamenti ?? 0} appuntamenti) sono salvati solo su questo dispositivo.
          Esporta un backup ogni settimana e conservalo su Google Drive: serve se il tablet si rompe o va sostituito.
        </p>
        <div className="riga a-capo">
          <button className="primario" onClick={esporta}>
            Esporta backup
          </button>
          <button onClick={() => file.current?.click()}>Ripristina da file…</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => importa(e.target.files?.[0])} />
        </div>
        {protetti != null && (
          <p className="tenue">
            {protetti
              ? '✓ Archivio protetto: Android non cancellerà i dati per liberare spazio.'
              : 'Archivio non ancora protetto: installa l\'app nella schermata Home per rendere i dati permanenti.'}
          </p>
        )}
      </section>
    </div>
  );
}
