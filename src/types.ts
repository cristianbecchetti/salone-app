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
  attivo: boolean;
}

export interface Cliente {
  id?: number;
  nome: string;
  cognome: string;
  telefono: string;
  note: string;
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
  passo: number;
  prefisso: string;
  /** indice = giorno della settimana (0 = domenica) */
  settimana: Fascia[][];
}
