import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { aggiungiSkill, db } from '../db';
import type { Fase, Servizio } from '../types';
import { minuti } from '../lib/tempo';
import { Campo, Modale } from '../ui';
import { Minuti } from '../scelte';

const NUOVA_FASE: Fase = { nome: '', tipo: 'lavoro', durata: 30, variabile: false };
const NUOVA_SKILL = '__nuova__';
const num =(v: string) => Math.max(0, Math.round(Number(v) || 0));

export default function Servizi() {
  const servizi = useLiveQuery(() => db.servizi.toArray(), []) ?? [];
  const [s, setS] = useState<Servizio | null>(null);
  const skillNote = (useLiveQuery(() => db.skill.orderBy('nome').toArray(), []) ?? []).map((k) => k.nome);

  const cambiaFase = (i: number, pezzo: Partial<Fase>) =>
    s && setS({ ...s, fasi: s.fasi.map((f, j) => (j === i ? { ...f, ...pezzo } : f)) });
  const sposta = (i: number, d: number) => {
    if (!s || i + d < 0 || i + d >= s.fasi.length) return;
    const fasi = [...s.fasi];
    [fasi[i], fasi[i + d]] = [fasi[i + d], fasi[i]];
    setS({ ...s, fasi });
  };

  async function salva() {
    if (!s || !s.nome.trim() || !s.fasi.length) return;
    const fasi = s.fasi.map((f) => ({
      ...f,
      nome: f.nome.trim() || (f.tipo === 'posa' ? 'Posa' : s.nome.trim()),
      competenza: f.tipo === 'lavoro' ? f.competenza?.trim() || undefined : undefined,
      min: f.variabile ? (f.min ?? f.durata) : undefined,
      max: f.variabile ? (f.max ?? f.durata) : undefined,
    }));
    await db.servizi.put({ ...s, nome: s.nome.trim(), fasi });
    setS(null);
  }
  async function elimina() {
    if (!s?.id || !confirm(`Eliminare il servizio "${s.nome}"? Gli appuntamenti già presi restano in agenda.`)) return;
    await db.servizi.delete(s.id);
    setS(null);
  }

  return (
    <div className="pagina">
      <header className="testata">
        <h1>Servizi</h1>
        <span className="spazio" />
        <button className="primario" onClick={() => setS({ nome: '', categoria: '', attivo: true, inviaConferma: false, preparazione: false, fasi: [{ ...NUOVA_FASE }] })}>
          + Servizio
        </button>
      </header>
      <p className="tenue">
        Ogni servizio è una sequenza di fasi, ognuna con la <b>skill</b> che richiede: così taglio e piega possono andare a operatori
        diversi. Durante una fase di <b>posa</b> l'operatore è libero per altri clienti. Le fasi a durata{' '}
        <b>variabile</b> vengono confermate o ritoccate a ogni prenotazione.
      </p>
      <div className="elenco">
        {servizi.map((x) => (
          <button key={x.id} className={`voce alta${x.attivo ? '' : ' spento'}`} onClick={() => setS(x)}>
            <span>
              <strong>{x.nome}</strong> <span className="tenue">{x.categoria}</span>
              {x.inviaConferma && <span className="etichetta verde">conferma WhatsApp</span>}
              {x.preparazione && <span className="etichetta">colore</span>}
              <span className="sequenza">
                {x.fasi.map((f, i) => (
                  <span key={i} className={`etichetta ${f.tipo}`}>
                    {f.nome}
                    {f.competenza && f.competenza !== f.nome ? ` · ${f.competenza}` : ''} {f.variabile && f.min != null && f.max != null && f.min !== f.max ? `${f.min}–${f.max}′` : `${f.durata}′`}
                  </span>
                ))}
              </span>
            </span>
            <span className="tenue">{minuti(x.fasi.reduce((t, f) => t + f.durata, 0))}</span>
          </button>
        ))}
      </div>

      {s && (
        <Modale
          titolo={s.id ? 'Modifica servizio' : 'Nuovo servizio'}
          largo
          onChiudi={() => setS(null)}
          azioni={
            <>
              {s.id && (
                <button className="pericolo" onClick={elimina}>
                  Elimina
                </button>
              )}
              <span className="spazio" />
              <button className="primario" disabled={!s.nome.trim() || !s.fasi.length} onClick={salva}>
                Salva
              </button>
            </>
          }
        >
          <div className="griglia-form due">
            <Campo etichetta="Nome">
              <input value={s.nome} onChange={(e) => setS({ ...s, nome: e.target.value })} />
            </Campo>
            <Campo etichetta="Categoria">
              <input value={s.categoria} onChange={(e) => setS({ ...s, categoria: e.target.value })} />
            </Campo>
          </div>
          <label className="spunta">
            <input type="checkbox" checked={s.attivo} onChange={(e) => setS({ ...s, attivo: e.target.checked })} />
            Prenotabile (a catalogo)
          </label>
          <label className="spunta">
            <input type="checkbox" checked={!!s.inviaConferma} onChange={(e) => setS({ ...s, inviaConferma: e.target.checked })} />
            Invia conferma su WhatsApp alla prenotazione (proposto, si può cambiare ogni volta)
          </label>
          <label className="spunta">
            <input type="checkbox" checked={!!s.preparazione} onChange={(e) => setS({ ...s, preparazione: e.target.checked })} />
            Richiede colore da preparare (compare in Preparazione colori)
          </label>
          <h4>Fasi</h4>
          {s.fasi.map((f, i) => (
            <div className={`fase-edit ${f.tipo}`} key={i}>
              <div className="riga a-capo">
                <input className="cresce" placeholder="Nome fase (es. Applicazione tinta)" value={f.nome} onChange={(e) => cambiaFase(i, { nome: e.target.value })} />
                <select value={f.tipo} onChange={(e) => cambiaFase(i, { tipo: e.target.value as Fase['tipo'] })} aria-label="Tipo di fase">
                  <option value="lavoro">Lavoro (operatore occupato)</option>
                  <option value="posa">Posa (operatore libero)</option>
                </select>
                <button className="icona" onClick={() => sposta(i, -1)} aria-label="Sposta su">
                  ↑
                </button>
                <button className="icona" onClick={() => sposta(i, 1)} aria-label="Sposta giù">
                  ↓
                </button>
                <button className="icona" onClick={() => setS({ ...s, fasi: s.fasi.filter((_, j) => j !== i) })} aria-label="Rimuovi fase">
                  ✕
                </button>
              </div>
              <div className="riga a-capo">
                {f.tipo === 'lavoro' && (
                  <label className="spunta">
                    Skill richiesta
                    <select
                      value={f.competenza ?? ''}
                      onChange={async (e) => {
                        if (e.target.value !== NUOVA_SKILL) return cambiaFase(i, { competenza: e.target.value || undefined });
                        const nome = await aggiungiSkill(prompt('Nome della nuova skill') ?? '');
                        if (nome) cambiaFase(i, { competenza: nome });
                      }}
                    >
                      <option value="">— nessuna (chiunque) —</option>
                      {[...new Set([...skillNote, ...(f.competenza ? [f.competenza] : [])])].map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                      <option value={NUOVA_SKILL}>+ Nuova skill…</option>
                    </select>
                  </label>
                )}
                <span className="spunta">
                  Durata standard
                  <Minuti label="durata standard" valore={f.durata} onChange={(n) => cambiaFase(i, { durata: n })} />
                </span>
                <label className="spunta">
                  <input
                    type="checkbox"
                    checked={f.variabile}
                    onChange={(e) => cambiaFase(i, { variabile: e.target.checked, min: f.min ?? f.durata, max: f.max ?? f.durata })}
                  />
                  varia in base al cliente
                </label>
                {f.variabile && (
                  <span className="spunta">
                    da
                    <Minuti label="durata minima" valore={f.min ?? f.durata} onChange={(n) => cambiaFase(i, { min: n })} />
                    a
                    <Minuti label="durata massima" valore={f.max ?? f.durata} onChange={(n) => cambiaFase(i, { max: n })} />
                  </span>
                )}
              </div>
            </div>
          ))}
          <button onClick={() => setS({ ...s, fasi: [...s.fasi, { ...NUOVA_FASE }] })}>+ Aggiungi fase</button>
        </Modale>
      )}
    </div>
  );
}
