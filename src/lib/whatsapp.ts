// Invio dei messaggi WhatsApp in due modi, scelti in Altro → Invio WhatsApp:
//  - 'app': apre WhatsApp con il testo già scritto (l'operatore preme invio)
//  - 'api': invia direttamente con la WhatsApp Business Cloud API di Meta, senza aprire WhatsApp.
// In entrambi i casi l'invio parte solo quando l'operatore tocca il pulsante.
import type { Impostazioni } from '../types';
import { linkWhatsApp } from './contatti';

export type TipoMessaggio = 'reminder' | 'conferma' | 'mese' | 'magazzino';

export const TEMPLATE_PREDEFINITI: Record<TipoMessaggio, string> = {
  reminder: 'promemoria_appuntamento',
  conferma: 'conferma_appuntamento',
  mese: 'riepilogo_mese',
  magazzino: 'preparazione_colori',
};

/** Testi da registrare su Meta per ogni template ({{n}} = parametri che l'app compila, in quest'ordine). */
export const TESTI_TEMPLATE: Record<TipoMessaggio, { testo: string; parametri: string }> = {
  reminder: {
    testo: 'Ciao {{1}}, ti ricordiamo il tuo appuntamento di {{2}} alle {{3}} per: {{4}}. Se non puoi venire avvisaci. A presto da {{5}}!',
    parametri: '1 nome, 2 data, 3 ora, 4 servizi, 5 nome salone',
  },
  conferma: {
    testo: 'Ciao {{1}}, confermiamo il tuo appuntamento di {{2}} alle {{3}} per: {{4}}. A presto da {{5}}!',
    parametri: '1 nome, 2 data, 3 ora, 4 servizi, 5 nome salone',
  },
  mese: {
    testo: 'Ciao {{1}}, ecco i tuoi appuntamenti di {{2}} da {{3}}: {{4}}. A presto!',
    parametri: '1 nome, 2 mese, 3 nome salone, 4 elenco appuntamenti',
  },
  magazzino: {
    testo: 'Preparazione colori di {{1}}: {{2}}. Grazie!',
    parametri: '1 data, 2 elenco colori',
  },
};

/** Meta rifiuta parametri con a capo, tabulazioni o più di 4 spazi di fila, e parametri vuoti. */
export const parametroPulito = (s: string) =>
  s
    .replace(/\s*[\r\n\t]+\s*/g, ' · ')
    .replace(/ {4,}/g, '   ')
    .trim() || '-';

/** Corpo della richiesta all'API per un messaggio da template. */
export function corpoTemplate(numero: string, template: string, lingua: string, parametri: string[]) {
  return {
    messaging_product: 'whatsapp',
    to: numero.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: template,
      language: { code: lingua },
      components: [{ type: 'body', parameters: parametri.map((p) => ({ type: 'text', text: parametroPulito(p) })) }],
    },
  };
}

export const modoApi = (imp: Impostazioni) => imp.waModo === 'api';

/** Cosa manca nelle impostazioni per l'invio diretto (vuoto = pronto). */
export function mancaConfigurazione(imp: Impostazioni): string[] {
  const manca: string[] = [];
  if (!imp.waPhoneId?.trim()) manca.push('ID del numero di telefono');
  if (!imp.waToken?.trim()) manca.push('token di accesso');
  return manca;
}

/** Invio diretto con l'API. Rifiuta con un messaggio leggibile se Meta segnala un errore. */
export async function inviaTemplate(imp: Impostazioni, tipo: TipoMessaggio, numero: string, parametri: string[]) {
  const manca = mancaConfigurazione(imp);
  if (manca.length) throw new Error(`Invio diretto non configurato: manca ${manca.join(' e ')} (Altro → Invio WhatsApp).`);
  if (!numero.replace(/\D/g, '')) throw new Error('Manca il numero di telefono.');
  const versione = imp.waVersione?.trim() || 'v23.0';
  const template = imp.waTemplate?.[tipo]?.trim() || TEMPLATE_PREDEFINITI[tipo];
  let risposta: Response;
  try {
    risposta = await fetch(`https://graph.facebook.com/${versione}/${imp.waPhoneId!.trim()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${imp.waToken!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpoTemplate(numero, template, imp.waLingua?.trim() || 'it', parametri)),
    });
  } catch {
    throw new Error('Nessuna connessione a internet: messaggio non inviato.');
  }
  const json = await risposta.json().catch(() => ({}));
  if (!risposta.ok) {
    const e = (json as { error?: { message?: string; error_data?: { details?: string } } }).error;
    throw new Error(`WhatsApp ha rifiutato il messaggio: ${e?.error_data?.details || e?.message || `errore ${risposta.status}`}`);
  }
}

/**
 * Punto unico di invio. Va chiamata direttamente dal tocco sul pulsante (prima di altre attese),
 * così in modalità 'app' il browser apre WhatsApp senza bloccarlo.
 * Restituisce false se l'operatore annulla la conferma.
 */
export async function inviaWhatsApp(p: {
  imp: Impostazioni;
  tipo: TipoMessaggio;
  numero: string;
  /** testo completo usato nella modalità 'app' */
  testo: string;
  /** parametri del template, usati nella modalità 'api' */
  parametri: string[];
  /** nome del destinatario, per la conferma */
  a: string;
}): Promise<boolean> {
  if (!modoApi(p.imp)) {
    window.open(linkWhatsApp(p.numero, p.testo), '_blank');
    return true;
  }
  if (!confirm(`Inviare ora il messaggio WhatsApp a ${p.a}?`)) return false;
  await inviaTemplate(p.imp, p.tipo, p.numero, p.parametri);
  return true;
}
