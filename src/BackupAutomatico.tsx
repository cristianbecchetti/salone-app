// Backup: esportazione su file, invio a Google Drive, controllo periodico e promemoria a comparsa.
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, esportaTutto, useImpostazioni } from './db';
import type { Impostazioni } from './types';
import {
  backupDriveDovuto,
  caricaSuDrive,
  erroreDriveDaSegnalare,
  giorniDa,
  nomeFileBackup,
  promemoriaDovuto,
} from './lib/backup';
import { Modale } from './ui';

/** ogni quanto, con l'app aperta, si controlla se c'è un backup o un promemoria da fare */
const CONTROLLO_OGNI = 5 * 60 * 1000;
const UN_ORA = 60 * 60 * 1000;
const UN_GIORNO = 24 * UN_ORA;

const segnaBackup = (pezzo: Partial<Impostazioni>) =>
  db.impostazioni.update('main', { ultimoBackup: new Date().toISOString(), promemoriaRinviatoA: undefined, ...pezzo });

/** Esporta su file: sul tablet apre "Condividi" (Drive, e-mail…), altrimenti scarica. Restituisce l'esito. */
export async function esportaSuFile(): Promise<string> {
  const nome = nomeFileBackup();
  const blob = new Blob([JSON.stringify(await esportaTutto())], { type: 'application/json' });
  const f = new File([blob], nome, { type: 'application/json' });
  if (navigator.canShare?.({ files: [f] })) {
    try {
      await navigator.share({ files: [f], title: 'Backup salone' });
      await segnaBackup({});
      return 'Backup condiviso.';
    } catch {
      /* condivisione annullata: si passa al download */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
  await segnaBackup({});
  return `Backup salvato come ${nome} nei download.`;
}

/** Backup su Google Drive tramite lo script del salone; registra esito ed eventuale errore. */
export async function backupSuDrive(imp: Impostazioni): Promise<string> {
  const ora = new Date().toISOString();
  await db.impostazioni.update('main', { driveUltimoTentativo: ora });
  try {
    const nome = nomeFileBackup();
    const r = await caricaSuDrive(imp.driveUrl ?? '', imp.driveChiave ?? '', nome, JSON.stringify(await esportaTutto()), imp.driveConserva ?? 30);
    await segnaBackup({ driveUltimoBackup: ora, driveUltimoFile: r.file ?? nome, driveErrore: '' });
    return `Backup salvato su Google Drive${r.email ? ` (${r.email})` : ''}: ${r.file ?? nome}.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.impostazioni.update('main', { driveErrore: msg });
    throw new Error(msg);
  }
}

const rinvia = (ms: number) => db.impostazioni.update('main', { promemoriaRinviatoA: new Date(Date.now() + ms).toISOString() });

/**
 * Sempre attivo mentre l'app è aperta: fa il backup automatico su Drive quando è il momento,
 * e mostra il promemoria (modalità manuale) o l'avviso di errore (modalità Drive).
 */
export default function BackupAutomatico() {
  const imp = useImpostazioni();
  const [adesso, setAdesso] = useState(Date.now());
  const [occupato, setOccupato] = useState(false);
  const [esito, setEsito] = useState('');
  const inCorso = useRef(false);

  // controllo all'avvio, ogni 5 minuti e quando l'app torna in primo piano o la rete ritorna
  useEffect(() => {
    const tic = () => setAdesso(Date.now());
    const t = setInterval(tic, CONTROLLO_OGNI);
    const visibile = () => document.visibilityState === 'visible' && tic();
    document.addEventListener('visibilitychange', visibile);
    window.addEventListener('online', tic);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', visibile);
      window.removeEventListener('online', tic);
    };
  }, []);

  // backup automatico in sottofondo
  useEffect(() => {
    if (inCorso.current || !backupDriveDovuto(imp, adesso) || !navigator.onLine) return;
    inCorso.current = true;
    backupSuDrive(imp)
      .catch(() => {})
      .finally(() => (inCorso.current = false));
  }, [imp, adesso]);

  // finché non ci sono clienti né appuntamenti non c'è niente da proteggere: niente promemoria
  const conDati = useLiveQuery(async () => (await db.clienti.count()) + (await db.appuntamenti.count()) > 0, []) ?? false;
  const promemoria = conDati && promemoriaDovuto(imp, adesso);
  const errore = !promemoria && erroreDriveDaSegnalare(imp, adesso);
  if (!promemoria && !errore) return null;

  const giorni = giorniDa(imp.ultimoBackup, adesso);
  const quando =
    giorni == null
      ? 'Non è mai stato fatto un backup.'
      : giorni === 0
        ? "L'ultimo backup è di oggi."
        : `L'ultimo backup è di ${giorni} ${giorni === 1 ? 'giorno' : 'giorni'} fa.`;

  async function esegui(fn: () => Promise<string>) {
    setOccupato(true);
    setEsito('');
    try {
      await fn();
      setAdesso(Date.now());
    } catch (err) {
      setEsito(err instanceof Error ? err.message : String(err));
    } finally {
      setOccupato(false);
    }
  }

  return (
    <Modale
      titolo={promemoria ? 'È ora di fare il backup' : 'Backup automatico non riuscito'}
      onChiudi={() => rinvia(UN_ORA)}
      azioni={
        <>
          <button onClick={() => rinvia(UN_ORA)}>Tra 1 ora</button>
          <button onClick={() => rinvia(UN_GIORNO)}>Domani</button>
          <span className="spazio" />
          {promemoria ? (
            <button className="primario" disabled={occupato} onClick={() => esegui(esportaSuFile)}>
              {occupato ? 'Esportazione…' : 'Esporta backup ora'}
            </button>
          ) : (
            <button className="primario" disabled={occupato || !imp.driveUrl} onClick={() => esegui(() => backupSuDrive(imp))}>
              {occupato ? 'Invio…' : 'Riprova ora'}
            </button>
          )}
        </>
      }
    >
      <p>{quando}</p>
      {promemoria ? (
        <p className="tenue">
          I dati sono solo su questo tablet: se si rompe o si perde, il backup è l'unico modo per recuperarli. Salva il file su Google
          Drive o invialo per e-mail. Frequenza del promemoria e backup automatico si impostano in Altro → Backup.
        </p>
      ) : (
        <>
          <p className="avviso">
            {imp.driveUrl ? imp.driveErrore || 'Ultimo tentativo non riuscito.' : 'Il collegamento a Google Drive non è configurato.'}
          </p>
          <p className="tenue">Controlla la connessione o le impostazioni in Altro → Backup. Nel frattempo puoi esportare un backup su file da lì.</p>
        </>
      )}
      {esito && <p className="avviso">{esito}</p>}
    </Modale>
  );
}
