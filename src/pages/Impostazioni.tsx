import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, esportaTutto, ripristina, useImpostazioni } from '../db';
import type { Impostazioni as Imp } from '../types';
import { componiMessaggio } from '../lib/contatti';
import { dataLunga, oggi, piuGiorni } from '../lib/tempo';
import { Campo } from '../ui';
import { TEMPLATE_PREDEFINITI, TESTI_TEMPLATE, inviaTemplate, mancaConfigurazione, type TipoMessaggio } from '../lib/whatsapp';

export default function Impostazioni() {
  const imp = useImpostazioni();
  const [msg, setMsg] = useState('');
  const [vediToken, setVediToken] = useState(false);
  const [numeroProva, setNumeroProva] = useState('');
  const [esitoProva, setEsitoProva] = useState('');
  const [protetti, setProtetti] = useState<boolean | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const conteggi = useLiveQuery(async () => ({ clienti: await db.clienti.count(), appuntamenti: await db.appuntamenti.count() }), []);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setProtetti).catch(() => {});
  }, []);

  const salva = (pezzo: Partial<Imp>) => db.impostazioni.put({ ...imp, ...pezzo });
  const api = imp.waModo === 'api';
  const nomeTemplate = (t: TipoMessaggio) => imp.waTemplate?.[t] ?? TEMPLATE_PREDEFINITI[t];

  /** Messaggio di prova con il template del promemoria, per verificare la configurazione. */
  async function prova() {
    setEsitoProva('Invio in corso…');
    try {
      await inviaTemplate(imp, 'reminder', numeroProva, ['Prova', dataLunga(piuGiorni(oggi(), 1)), '10:30', 'Colore base', imp.nomeSalone]);
      setEsitoProva('✓ Messaggio di prova inviato: controlla WhatsApp sul numero indicato.');
    } catch (err) {
      setEsitoProva(err instanceof Error ? err.message : String(err));
    }
  }

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
        <h3>Invio WhatsApp</h3>
        <Campo etichetta="Come inviare i messaggi">
          <select value={api ? 'api' : 'app'} onChange={(e) => salva({ waModo: e.target.value as 'app' | 'api' })}>
            <option value="app">Apri WhatsApp con il messaggio pronto (come ora)</option>
            <option value="api">Invio diretto, senza aprire WhatsApp (WhatsApp Business API)</option>
          </select>
        </Campo>
        <p className="tenue">
          In entrambi i casi il messaggio parte solo quando l'operatore tocca il pulsante di invio
          {api ? ' e conferma.' : '.'} Vale per promemoria, conferme, riepilogo del mese e preparazione colori.
        </p>
        {api && (
          <>
            {mancaConfigurazione(imp).length > 0 && (
              <p className="avviso">Per l'invio diretto manca: {mancaConfigurazione(imp).join(', ')}. Finché manca, i messaggi non partono.</p>
            )}
            <div className="griglia-form due">
              <Campo etichetta="ID del numero di telefono" nota="Meta for Developers → WhatsApp → Configurazione API">
                <input inputMode="numeric" value={imp.waPhoneId ?? ''} onChange={(e) => salva({ waPhoneId: e.target.value.trim() })} />
              </Campo>
              <Campo etichetta="Token di accesso permanente" nota="Resta solo su questo tablet e non viene messo nei backup.">
                <div className="riga">
                  <input
                    className="cresce"
                    type={vediToken ? 'text' : 'password'}
                    autoComplete="off"
                    value={imp.waToken ?? ''}
                    onChange={(e) => salva({ waToken: e.target.value.trim() })}
                  />
                  <button type="button" className="piccolo" onClick={() => setVediToken(!vediToken)}>
                    {vediToken ? 'Nascondi' : 'Mostra'}
                  </button>
                </div>
              </Campo>
              <Campo etichetta="Versione API" nota="Lasciare quella indicata da Meta, es. v23.0">
                <input value={imp.waVersione ?? 'v23.0'} onChange={(e) => salva({ waVersione: e.target.value.trim() })} />
              </Campo>
              <Campo etichetta="Lingua dei template" nota="Codice lingua scelto su Meta, es. it">
                <input value={imp.waLingua ?? 'it'} onChange={(e) => salva({ waLingua: e.target.value.trim() })} />
              </Campo>
            </div>
            <h4>Template approvati da Meta</h4>
            <p className="tenue">
              Con l'invio diretto il testo dei messaggi è quello del template approvato su Meta (i testi sopra valgono solo per
              "Apri WhatsApp"). Crea su Meta i template seguenti, categoria Utilità, lingua italiano, e scrivi qui il loro nome.
            </p>
            {(Object.keys(TESTI_TEMPLATE) as TipoMessaggio[]).map((t) => (
              <div className="template-wa" key={t}>
                <Campo
                  etichetta={{ reminder: 'Promemoria', conferma: 'Conferma prenotazione', mese: 'Riepilogo del mese', magazzino: 'Preparazione colori' }[t]}
                  nota={`Parametri: ${TESTI_TEMPLATE[t].parametri}`}
                >
                  <input value={nomeTemplate(t)} onChange={(e) => salva({ waTemplate: { ...imp.waTemplate, [t]: e.target.value.trim() } })} />
                </Campo>
                <p className="anteprima">{TESTI_TEMPLATE[t].testo}</p>
              </div>
            ))}
            <h4>Prova</h4>
            <div className="riga a-capo">
              <input inputMode="tel" placeholder="Numero di prova, es. +39 333 1234567" value={numeroProva} onChange={(e) => setNumeroProva(e.target.value)} />
              <button disabled={!numeroProva.trim()} onClick={prova}>
                Invia messaggio di prova
              </button>
            </div>
            {esitoProva && <p className={esitoProva.startsWith('✓') || esitoProva.startsWith('Invio') ? 'nota' : 'avviso'}>{esitoProva}</p>}
          </>
        )}
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
