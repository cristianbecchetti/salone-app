// Tutti gli orari sono minuti dalla mezzanotte; le date stringhe 'AAAA-MM-GG'.

export type TipoFase = 'lavoro' | 'posa';

export interface Fascia {
  da: number;
  a: number;
}

/** Una fase di un servizio a catalogo. `posa` = l'operatore è libero. */
export interface Fase {
  nome: string;
  tipo: TipoFase;
  durata: number;
  /** true = la durata va confermata/ritoccata per ogni cliente */
  variabile: boolean;
  min?: number;
  max?: number;
  /** skill richiesta all'operatore per questa fase (es. "Taglio", "Piega"). Vuota = chiunque. */
  competenza?: string;
}

/** Anagrafica delle skill: le fasi ne richiedono una, gli operatori ne possiedono alcune. */
export interface Skill {
  id?: number;
  nome: string;
}

export interface Servizio {
  id?: number;
  nome: string;
  categoria: string;
  fasi: Fase[];
  attivo: boolean;
  /** valore proposto in prenotazione per "invia conferma su WhatsApp" */
  inviaConferma?: boolean;
  /** il servizio usa un colore da preparare: compare nella pagina Preparazione colori */
  preparazione?: boolean;
}

export interface Assenza {
  dal: string;
  al: string;
  nota: string;
  /** solo una parte della giornata (minuti dalla mezzanotte), ogni giorno del periodo; assenti = tutto il giorno */
  da?: number;
  a?: number;
}

/** Orario straordinario di un operatore in una data: sostituisce il suo turno di quel giorno, anche fuori dall'apertura del salone. */
export interface Straordinario {
  data: string;
  fasce: Fascia[];
  nota: string;
}

export interface Operatore {
  id?: number;
  nome: string;
  colore: string;
  /** skill possedute, confrontate con la `competenza` richiesta da ogni fase */
  competenze: string[];
  /** indice = giorno della settimana (0 = domenica). null = segue gli orari del salone, [] = non lavora */
  turni: (Fascia[] | null)[];
  assenze: Assenza[];
  /** orari straordinari per data (es. sabato fino alle 21, domenica per una sposa) */
  straordinari?: Straordinario[];
  attivo: boolean;
}

export interface Cliente {
  id?: number;
  nome: string;
  cognome: string;
  telefono: string;
  note: string;
  /** cliente bloccato: alla creazione di un appuntamento compare un avviso */
  bloccato?: boolean;
  motivoBlocco?: string;
  /** data del blocco (AAAA-MM-GG) */
  bloccatoIl?: string;
}

export interface FaseApp {
  serviceId: number;
  servizio: string;
  nome: string;
  tipo: TipoFase;
  inizio: number;
  durata: number;
  staffId: number | null;
  competenza?: string;
}

export type Stato = 'prenotato' | 'completato' | 'assente' | 'annullato';

export interface Appuntamento {
  id?: number;
  clientId: number;
  data: string;
  inizio: number;
  fine: number;
  fasi: FaseApp[];
  stato: Stato;
  note: string;
  reminderInviatoIl?: string;
  /** il magazzino ha segnato il colore come preparato */
  preparatoIl?: string;
}

export interface ComponenteColore {
  tonalita: string;
  grammi: number;
}

/** Ricetta colore eseguita (o prevista) per un cliente. */
export interface SchedaColore {
  id?: number;
  clientId: number;
  data: string;
  /** appuntamento a cui si riferisce, se registrata da un appuntamento */
  appuntamentoId?: number;
  brand: string;
  componenti: ComponenteColore[];
  /** es. "20 vol" o "6%" */
  ossigeno: string;
  grammiOssigeno: number;
  note: string;
}

/** Orario diverso dal solito per una data precisa. fasce vuote = chiuso. */
export interface Eccezione {
  data: string;
  fasce: Fascia[];
  nota: string;
}

export interface Impostazioni {
  id: 'main';
  nomeSalone: string;
  messaggio: string;
  /** testo inviato alla conferma della prenotazione */
  messaggioConferma?: string;
  /** introduzione del riepilogo appuntamenti del mese */
  messaggioMese?: string;
  /** numero WhatsApp a cui mandare la preparazione colori */
  numeroMagazzino?: string;
  /** 'app' = apre WhatsApp con il testo pronto; 'api' = invio diretto con WhatsApp Business Cloud API */
  waModo?: 'app' | 'api';
  /** Cloud API: ID del numero di telefono mittente (Meta) */
  waPhoneId?: string;
  /** Cloud API: token di accesso. Resta solo su questo dispositivo, escluso dai backup. */
  waToken?: string;
  /** Cloud API: versione delle Graph API, es. "v23.0" */
  waVersione?: string;
  /** Cloud API: codice lingua dei template, es. "it" */
  waLingua?: string;
  /** Cloud API: nome del template approvato per ogni tipo di messaggio */
  waTemplate?: Partial<Record<'reminder' | 'conferma' | 'mese' | 'magazzino', string>>;
  /** 'manuale' = backup su file con promemoria; 'drive' = backup automatico su Google Drive */
  backupModo?: 'manuale' | 'drive';
  /** Drive: ogni quanti giorni fare il backup automatico */
  backupOgniGiorni?: number;
  /** manuale: ogni quanti giorni mostrare il promemoria (0 = mai) */
  promemoriaBackupGiorni?: number;
  /** promemoria rinviato fino a questo momento (ISO) */
  promemoriaRinviatoA?: string;
  /** ultimo backup fatto, manuale o automatico (ISO) */
  ultimoBackup?: string;
  /** Drive: account Google del salone (per controllo) */
  driveEmail?: string;
  /** Drive: indirizzo dell'app web dello script Google */
  driveUrl?: string;
  /** Drive: chiave condivisa con lo script. Resta su questo dispositivo, esclusa dai backup. */
  driveChiave?: string;
  /** Drive: quanti backup tenere nella cartella */
  driveConserva?: number;
  driveUltimoBackup?: string;
  driveUltimoTentativo?: string;
  driveUltimoFile?: string;
  /** Drive: ultimo errore (vuoto se l'ultimo tentativo è riuscito) */
  driveErrore?: string;
  /** fasce orarie con nome per filtrare gli orari proposti in prenotazione (es. Mattina 9-13) */
  fasceOrarie?: { nome: string; da: number; a: number }[];
  /** pagina Reminder: mostra tutti, oppure solo gli appuntamenti di almeno / meno di N minuti */
  reminderFiltro?: { verso: 'tutti' | 'almeno' | 'meno'; minuti: number };
  /** funzioni facoltative, attivabili e disattivabili in Altro */
  funzioni?: { cartacea?: boolean };
  /** questo dispositivo condivide i dati con gli altri tramite il file su Google Drive */
  syncAttiva?: boolean;
  /** ultima sincronizzazione riuscita (ISO) */
  syncUltima?: string;
  /** ultimo errore di sincronizzazione (vuoto se tutto ok) */
  syncErrore?: string;
  /** dispositivo appena collegato: alla prima sincronizzazione prende tutto dal file condiviso */
  syncSostituisci?: boolean;
  /** dopo un ripristino da file: i dati di questo dispositivo diventano quelli di tutti */
  syncForzaInvio?: boolean;
  /** moltiplicatore della dimensione di testo e controlli (1 = normale) */
  scalaTesto?: number;
  passo: number;
  prefisso: string;
  /** indice = giorno della settimana (0 = domenica) */
  settimana: Fascia[][];
}
