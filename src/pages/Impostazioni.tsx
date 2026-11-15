import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ripristina, useImpostazioni } from '../db';
import { backupSuDrive, esportaSuFile } from '../BackupAutomatico';
import { avvisoEmail, codiceScript, driveConfigurato, verificaDrive } from '../lib/backup';
import type { Impostazioni as Imp } from '../types';
import { PAESI, bandiera, componiMessaggio } from '../lib/contatti';
import { Telefono } from '../scelte';
import { collegaDispositivo, leggiCollegamento, linkCollegamento, sincronizza } from '../sincronizza';
import { soloDispositivo, type Record_ } from '../lib/sincronia';
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
    setMsg(await esportaSuFile());
  }

  // ---- backup su Google Drive ----
  const drive = imp.backupModo === 'drive';
  const [vediChiave, setVediChiave] = useState(false);
  // condivisione dei dati tra dispositivi
  const [occupatoSync, setOccupatoSync] = useState(false);
  const [link, setLink] = useState('');
  const [msgLink, setMsgLink] = useState('');
  const [linkIncollato, setLinkIncollato] = useState('');
  const [esitoDrive, setEsitoDrive] = useState('');
  const [occupatoDrive, setOccupatoDrive] = useState(false);
  async function operazioneDrive(fn: () => Promise<string>) {
    setOccupatoDrive(true);
    setEsitoDrive('');
    try {
      setEsitoDrive(await fn());
    } catch (err) {
      setEsitoDrive(err instanceof Error ? err.message : String(err));
    } finally {
      setOccupatoDrive(false);
    }
  }
  const verifica = () =>
    operazioneDrive(async () => {
      const r = await verificaDrive(imp.driveUrl ?? '', imp.driveChiave ?? '');
      const avviso = avvisoEmail(imp.driveEmail, r.email);
      if (avviso) throw new Error(avviso);
      return `✓ Collegamento riuscito: i backup vanno nel Drive di ${r.email}, cartella "Backup Salone".`;
    });
  const backupOra = () => operazioneDrive(async () => `✓ ${await backupSuDrive(imp)}`);
  async function copiaCodice() {
    let chiave = imp.driveChiave?.trim();
    if (!chiave) {
      chiave = crypto.randomUUID().replace(/-/g, '');
      await salva({ driveChiave: chiave });
    }
    try {
      await navigator.clipboard.writeText(codiceScript(chiave));
      setEsitoDrive('✓ Codice copiato: incollalo su script.google.com (vedi i passi sotto).');
    } catch {
      setEsitoDrive('Copia non riuscita: seleziona il codice qui sotto e copialo a mano.');
    }
  }
  const quando = (iso?: string) => (iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' }) : 'mai');

  async function importa(f?: File) {
    if (!f) return;
    try {
      const backup = JSON.parse(await f.text());
      const condivisi = imp.syncAttiva ? ' anche su tutti i dispositivi collegati' : '';
      if (confirm(`Ripristinare il backup? Tutti i dati attuali verranno sostituiti${condivisi}.`)) {
        // le impostazioni di questo dispositivo (Drive, sincronizzazione, token…) restano quelle di prima
        const proprie = soloDispositivo((await db.impostazioni.get('main')) as Record_ | undefined);
        await ripristina(backup);
        await db.impostazioni.update('main', { ...proprie, ...(proprie.syncAttiva ? { syncForzaInvio: true } : {}) });
        if (proprie.syncAttiva) await sincronizza();
        setMsg(proprie.syncAttiva ? 'Backup ripristinato e inviato agli altri dispositivi.' : 'Backup ripristinato.');
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
            <select value={imp.prefisso} onChange={(e) => salva({ prefisso: e.target.value })}>
              {PAESI.map((x) => (
                <option key={x.iso} value={x.prefisso}>
                  {bandiera(x.iso)} {x.prefisso} {x.nome}
                </option>
              ))}
            </select>
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
          <Telefono valore={imp.numeroMagazzino ?? ''} prefissoBase={imp.prefisso} label="numero del magazzino" onChange={(t) => salva({ numeroMagazzino: t })} />
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
              <Telefono valore={numeroProva} prefissoBase={imp.prefisso} label="numero di prova" onChange={setNumeroProva} />
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
          I dati ({conteggi?.clienti ?? 0} clienti, {conteggi?.appuntamenti ?? 0} appuntamenti) sono salvati solo su questo dispositivo: il
          backup serve se il tablet si rompe o va sostituito. Ultimo backup: <b>{quando(imp.ultimoBackup)}</b>.
        </p>
        <div className="riga a-capo">
          <button className="primario" onClick={esporta}>
            Esporta backup su file
          </button>
          <button onClick={() => file.current?.click()}>Ripristina da file…</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => importa(e.target.files?.[0])} />
        </div>

        <div className="griglia-form due">
          <Campo etichetta="Modalità di backup">
            <select value={drive ? 'drive' : 'manuale'} onChange={(e) => salva({ backupModo: e.target.value as 'manuale' | 'drive' })}>
              <option value="manuale">Manuale, con promemoria</option>
              <option value="drive">Automatico su Google Drive</option>
            </select>
          </Campo>
          {!drive ? (
            <Campo etichetta="Promemoria a comparsa" nota="Si ripresenta finché non fai il backup; si può rinviare di 1 ora o a domani.">
              <select value={imp.promemoriaBackupGiorni ?? 7} onChange={(e) => salva({ promemoriaBackupGiorni: Number(e.target.value) })}>
                <option value={1}>Ogni giorno</option>
                <option value={2}>Ogni 2 giorni</option>
                <option value={3}>Ogni 3 giorni</option>
                <option value={7}>Ogni settimana</option>
                <option value={14}>Ogni 2 settimane</option>
                <option value={30}>Ogni mese</option>
                <option value={0}>Mai (sconsigliato)</option>
              </select>
            </Campo>
          ) : (
            <Campo etichetta="Backup automatico" nota="Parte da solo mentre l'app è aperta, quando è il momento.">
              <select value={imp.backupOgniGiorni ?? 1} onChange={(e) => salva({ backupOgniGiorni: Number(e.target.value) })}>
                <option value={1}>Ogni giorno</option>
                <option value={2}>Ogni 2 giorni</option>
                <option value={3}>Ogni 3 giorni</option>
                <option value={7}>Ogni settimana</option>
                <option value={14}>Ogni 2 settimane</option>
                <option value={30}>Ogni mese</option>
              </select>
            </Campo>
          )}
        </div>

        {drive && (
          <>
            {!driveConfigurato(imp) && (
              <p className="avviso">Backup automatico non ancora attivo: segui i passi "Come collegare Google Drive" qui sotto.</p>
            )}
            <div className="griglia-form due">
              <Campo etichetta="Account Google del salone" nota="Il Drive dove finiscono i backup: deve essere lo stesso account con cui crei lo script.">
                <input type="email" inputMode="email" value={imp.driveEmail ?? ''} placeholder="salone@gmail.com" onChange={(e) => salva({ driveEmail: e.target.value.trim() })} />
              </Campo>
              <Campo etichetta="Backup da conservare su Drive" nota="I più vecchi vanno nel cestino di Drive.">
                <select value={imp.driveConserva ?? 30} onChange={(e) => salva({ driveConserva: Number(e.target.value) })}>
                  {[7, 14, 30, 60, 90].map((n) => (
                    <option key={n} value={n}>
                      Ultimi {n}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo etichetta="Indirizzo dello script (App web)" nota="Lo copi da script.google.com dopo il deployment: finisce con /exec.">
              <input inputMode="url" value={imp.driveUrl ?? ''} placeholder="https://script.google.com/macros/s/…/exec" onChange={(e) => salva({ driveUrl: e.target.value.trim() })} />
            </Campo>
            <Campo etichetta="Chiave segreta" nota="Generata dall'app e inserita nel codice dello script. Resta su questo tablet, non va nei backup.">
              <div className="riga">
                <input
                  className="cresce"
                  type={vediChiave ? 'text' : 'password'}
                  autoComplete="off"
                  value={imp.driveChiave ?? ''}
                  onChange={(e) => salva({ driveChiave: e.target.value.trim() })}
                />
                <button type="button" className="piccolo" onClick={() => setVediChiave(!vediChiave)}>
                  {vediChiave ? 'Nascondi' : 'Mostra'}
                </button>
              </div>
            </Campo>
            <div className="riga a-capo">
              <button onClick={copiaCodice}>1 · Copia il codice dello script</button>
              <button disabled={occupatoDrive || !imp.driveUrl || !imp.driveChiave} onClick={verifica}>
                2 · Verifica collegamento
              </button>
              <button className="primario" disabled={occupatoDrive || !imp.driveUrl || !imp.driveChiave} onClick={backupOra}>
                {occupatoDrive ? 'Attendere…' : 'Backup su Drive ora'}
              </button>
            </div>
            {esitoDrive && <p className={esitoDrive.startsWith('✓') ? 'nota' : 'avviso'}>{esitoDrive}</p>}
            <p className="tenue">
              Ultimo backup su Drive: <b>{quando(imp.driveUltimoBackup)}</b>
              {imp.driveUltimoFile ? ` (${imp.driveUltimoFile})` : ''}
              {imp.driveErrore ? '' : imp.driveUltimoBackup ? ' ✓' : ''}
            </p>
            {imp.driveErrore && <p className="avviso">Ultimo tentativo non riuscito: {imp.driveErrore}</p>}
            <details className="istruzioni">
              <summary>Come collegare Google Drive (una volta sola, circa 5 minuti)</summary>
              <ol>
                <li>Tocca <b>Copia il codice dello script</b> (crea anche la chiave segreta).</li>
                <li>
                  Apri <b>script.google.com</b> con l'account Google del salone → <b>Nuovo progetto</b> → cancella il contenuto e incolla il
                  codice → salva (icona del dischetto).
                </li>
                <li>
                  Nella barra in alto scegli la funzione <b>autorizza</b> e premi <b>Esegui</b> → <b>Rivedi autorizzazioni</b> → account del
                  salone → <b>Avanzate → Vai a … (non sicuro)</b> → se compaiono caselle spunta <b>Seleziona tutto</b> (anche Google Drive) →{' '}
                  <b>Continua</b>. Nel registro deve comparire "Drive autorizzato".
                </li>
                <li>
                  In alto a destra <b>Esegui il deployment → Nuovo deployment</b> → tipo <b>App web</b> → "Esegui come: <b>Me</b>", "Chi ha
                  accesso: <b>Chiunque</b>" → <b>Esegui il deployment</b>.
                </li>
                <li>
                  Copia l'<b>URL dell'app web</b> (finisce con /exec) e incollalo qui sopra in "Indirizzo dello script".
                </li>
                <li>
                  Tocca <b>Verifica collegamento</b>, poi <b>Backup su Drive ora</b>: in Drive compare la cartella "Backup Salone".
                </li>
              </ol>
              <p className="tenue">
                Per ripristinare: scarica il file da Drive e usa "Ripristina da file…". Se cambi la chiave, va ricopiato il codice e rifatto
                il deployment.
              </p>
              <pre className="codice">{codiceScript(imp.driveChiave || '(la chiave viene creata con il pulsante 1)')}</pre>
            </details>
          </>
        )}
        {protetti != null && (
          <p className="tenue">
            {protetti
              ? '✓ Archivio protetto: Android non cancellerà i dati per liberare spazio.'
              : 'Archivio non ancora protetto: installa l\'app nella schermata Home per rendere i dati permanenti.'}
          </p>
        )}
      </section>

      <section className="scheda">
        <h3>Stessi dati su più dispositivi</h3>
        <p className="tenue">
          Tablet, telefono e PC possono usare la stessa agenda, gli stessi clienti e le stesse impostazioni del salone. I dati passano da un
          file nella cartella "Backup Salone" del Google Drive collegato qui sopra; le modifiche arrivano sugli altri dispositivi entro un
          paio di minuti (serve internet).
        </p>
        {!imp.syncAttiva && (
          <div className="link-collega">
            <p>
              <b>Nuovo dispositivo?</b> Incolla qui il link ricevuto dal tablet (Altro → Collega un altro dispositivo). Su iPhone usa questo
              campo dall'app già aggiunta alla schermata Home.
            </p>
            <div className="riga">
              <input
                className="cresce"
                aria-label="Link di collegamento da incollare"
                placeholder="https://…#collega=…"
                value={linkIncollato}
                onChange={(e) => setLinkIncollato(e.target.value)}
              />
              <button
                className="primario"
                disabled={!linkIncollato.trim() || occupatoSync}
                onClick={async () => {
                  const pezzo = /#collega=[\w-]+/.exec(linkIncollato.trim())?.[0];
                  const dati = pezzo ? leggiCollegamento(pezzo) : null;
                  if (!dati) {
                    setMsgLink('Link non valido: copialo di nuovo per intero dal messaggio.');
                    return;
                  }
                  if (!confirm('Collegare questo dispositivo? I dati presenti qui verranno sostituiti da quelli condivisi del salone.')) return;
                  setOccupatoSync(true);
                  await collegaDispositivo(dati);
                  setOccupatoSync(false);
                  setLinkIncollato('');
                  setMsgLink('');
                }}
              >
                {occupatoSync ? 'Collegamento…' : 'Collega'}
              </button>
            </div>
            {msgLink && !link && <p className="avviso">{msgLink}</p>}
          </div>
        )}
        {!imp.driveUrl || !imp.driveChiave ? (
          <p className="avviso">Prima collega Google Drive nella sezione Backup qui sopra (indirizzo dello script e chiave).</p>
        ) : (
          <>
            <label className="spunta">
              <input
                type="checkbox"
                checked={!!imp.syncAttiva}
                onChange={async (e) => {
                  await salva({ syncAttiva: e.target.checked, syncErrore: '' });
                  if (e.target.checked) void sincronizza();
                }}
              />
              Condividi i dati di questo dispositivo con gli altri
            </label>
            {imp.syncAttiva && (
              <>
                <p className={imp.syncErrore ? 'avviso' : 'tenue'}>
                  {imp.syncErrore
                    ? `Ultima sincronizzazione non riuscita: ${imp.syncErrore}`
                    : `Ultima sincronizzazione: ${quando(imp.syncUltima)}`}
                </p>
                <div className="riga a-capo">
                  <button
                    disabled={occupatoSync}
                    onClick={async () => {
                      setOccupatoSync(true);
                      await sincronizza();
                      setOccupatoSync(false);
                    }}
                  >
                    {occupatoSync ? 'Sincronizzazione…' : 'Sincronizza ora'}
                  </button>
                  <button onClick={() => setLink(linkCollegamento(imp, location.origin + location.pathname))}>Collega un altro dispositivo</button>
                </div>
                {link && (
                  <div className="link-collega">
                    <p>
                      Apri questo link sull'altro dispositivo (con Chrome), installa l'app da lì e conferma il collegamento. Mandalo a te stesso
                      con WhatsApp o e-mail:
                    </p>
                    <input readOnly value={link} aria-label="Link di collegamento" onFocus={(e) => e.target.select()} />
                    <div className="riga a-capo">
                      <button
                        className="primario"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(link);
                            setMsgLink('✓ Link copiato.');
                          } catch {
                            setMsgLink('Copia non riuscita: tieni premuto sul link e copialo.');
                          }
                        }}
                      >
                        Copia link
                      </button>
                      {typeof navigator.share === 'function' && (
                        <button onClick={() => navigator.share({ title: 'Collega app salone', text: link }).catch(() => {})}>Condividi…</button>
                      )}
                      <button onClick={() => setLink('')}>Chiudi</button>
                    </div>
                    {msgLink && <p className="nota">{msgLink}</p>}
                    <p className="tenue">
                      Il link contiene la chiave segreta del collegamento a Drive: mandalo solo a te stesso o a chi lavora nel salone.
                    </p>
                  </div>
                )}
              </>
            )}
            <details className="istruzioni">
              <summary>Prima volta: aggiorna lo script su Google</summary>
              <p className="tenue">
                Per condividere i dati lo script su Google deve essere la versione nuova. Una sola volta: tocca "Copia il codice dello script"
                nella sezione Backup, incollalo su script.google.com al posto del vecchio, salva e poi <b>Esegui il deployment → Gestisci
                deployment → ✏️ Modifica → Versione: Nuova versione → Esegui il deployment</b>. L'indirizzo resta lo stesso.
              </p>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
