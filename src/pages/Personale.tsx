import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { aggiungiSkill, cambiaSkill, db, useImpostazioni } from '../db';
import type { Operatore, Skill } from '../types';
import { GIORNI, ORDINE_GIORNI, dataNum, oggi } from '../lib/tempo';
import { Campo, FasceEditor, Modale, Ora, Pallino } from '../ui';
import { SceltaData } from '../scelte';

const COLORI = ['#8e4a7b', '#2f7d8c', '#b8672f', '#4f7a3a', '#5a5fb0', '#b0475a', '#7a6a2f', '#3d6e9e'];

export default function Personale() {
  const imp = useImpostazioni();
  const operatori = useLiveQuery(() => db.operatori.toArray(), []) ?? [];
  const servizi = useLiveQuery(() => db.servizi.toArray(), []) ?? [];
  const [o, setO] = useState<Operatore | null>(null);
  const skill = useLiveQuery(() => db.skill.orderBy('nome').toArray(), []) ?? [];
  const tutteLeSkill = skill.map((k) => k.nome);
  const [nuova, setNuova] = useState('');
  const [nuovaOp, setNuovaOp] = useState('');
  const [inModifica, setInModifica] = useState<Skill | null>(null);
  const [errore, setErrore] = useState('');

  /** quante fasi di servizi e quanti operatori usano la skill */
  const uso = (nome: string) => ({
    fasi: servizi.reduce((n, s) => n + s.fasi.filter((f) => f.competenza === nome).length, 0),
    operatori: operatori.filter((x) => x.competenze.includes(nome)).length,
  });

  async function creaSkill() {
    if (await aggiungiSkill(nuova)) setNuova('');
  }
  /** crea la skill (se manca) e la assegna all'operatore aperto */
  async function creaSkillPerOperatore() {
    const nome = await aggiungiSkill(nuovaOp);
    if (!nome || !o) return;
    if (!o.competenze.includes(nome)) setO({ ...o, competenze: [...o.competenze, nome] });
    setNuovaOp('');
  }
  async function salvaSkill() {
    if (!inModifica?.id || !inModifica.nome.trim()) return;
    const err = await cambiaSkill(inModifica.id, inModifica.nome);
    if (err) setErrore(err);
    else setInModifica(null);
  }
  async function eliminaSkill() {
    if (!inModifica?.id) return;
    const originale = skill.find((k) => k.id === inModifica.id)?.nome ?? inModifica.nome;
    const u = uso(originale);
    const dove = u.fasi || u.operatori ? ` Verrà tolta da ${u.fasi} fasi di servizi e ${u.operatori} operatori.` : '';
    if (!confirm(`Eliminare la skill "${originale}"?${dove}`)) return;
    await cambiaSkill(inModifica.id, null);
    setInModifica(null);
  }

  const nuovo = (): Operatore => ({
    nome: '',
    colore: COLORI[operatori.length % COLORI.length],
    competenze: [...tutteLeSkill],
    turni: [null, null, null, null, null, null, null],
    assenze: [],
    attivo: true,
  });
  const setTurno = (g: number, t: Operatore['turni'][number]) => o && setO({ ...o, turni: o.turni.map((x, i) => (i === g ? t : x)) });

  async function salva() {
    if (!o || !o.nome.trim()) return;
    await db.operatori.put({ ...o, nome: o.nome.trim(), assenze: o.assenze.filter((a) => a.dal && a.al) });
    setO(null);
  }
  async function elimina() {
    if (!o?.id) return;
    if (!confirm(`Eliminare ${o.nome}? Se ha appuntamenti in agenda è meglio disattivarlo: resterebbero senza operatore.`)) return;
    await db.operatori.delete(o.id);
    setO(null);
  }

  return (
    <div className="pagina">
      <header className="testata">
        <h1>Personale</h1>
        <span className="spazio" />
        <button className="primario" onClick={() => setO(nuovo())}>
          + Operatore
        </button>
      </header>

      <section className="scheda">
        <h3>Anagrafica skill</h3>
        <p className="tenue">
          Le skill si creano qui, si assegnano agli operatori e si collegano alle fasi dei servizi (in Servizi): gli slot vengono proposti
          solo a chi ha la skill richiesta dalla fase. Tocca una skill per rinominarla o eliminarla.
        </p>
        <div className="chips">
          {skill.map((k) => {
            const u = uso(k.nome);
            return (
              <button
                key={k.id}
                className="chip"
                onClick={() => {
                  setErrore('');
                  setInModifica(k);
                }}
              >
                {k.nome}
                <span className="tenue">
                  {u.operatori} op. · {u.fasi} fasi
                </span>
              </button>
            );
          })}
          {!skill.length && <span className="tenue">Nessuna skill: aggiungine una.</span>}
        </div>
        <div className="riga a-capo">
          <input
            placeholder="Nuova skill (es. Barba, Extension)"
            value={nuova}
            onChange={(e) => setNuova(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && creaSkill()}
          />
          <button disabled={!nuova.trim()} onClick={creaSkill}>
            + Aggiungi skill
          </button>
        </div>
      </section>

      <div className="elenco">
        {operatori.map((x) => (
          <button key={x.id} className={`voce alta${x.attivo ? '' : ' spento'}`} onClick={() => setO(x)}>
            <span>
              <Pallino colore={x.colore} /> <strong>{x.nome}</strong> {!x.attivo && <span className="tenue">(non attivo)</span>}
              <span className="sequenza">
                {x.competenze.map((k) => (
                  <span key={k} className="etichetta">
                    {k}
                  </span>
                ))}
                {!x.competenze.length && <span className="tenue">nessuna skill</span>}
              </span>
            </span>
          </button>
        ))}
      </div>

      {o && (
        <Modale
          titolo={o.id ? o.nome : 'Nuovo operatore'}
          largo
          onChiudi={() => setO(null)}
          azioni={
            <>
              {o.id && (
                <button className="pericolo" onClick={elimina}>
                  Elimina
                </button>
              )}
              <span className="spazio" />
              <button className="primario" disabled={!o.nome.trim()} onClick={salva}>
                Salva
              </button>
            </>
          }
        >
          <div className="griglia-form due">
            <Campo etichetta="Nome">
              <input value={o.nome} onChange={(e) => setO({ ...o, nome: e.target.value })} />
            </Campo>
            <Campo etichetta="Colore in agenda">
              <div className="chips">
                {COLORI.map((c) => (
                  <button key={c} className={`colore${o.colore === c ? ' scelto' : ''}`} style={{ background: c }} onClick={() => setO({ ...o, colore: c })} aria-label={`Colore ${c}`} />
                ))}
              </div>
            </Campo>
          </div>
          <label className="spunta">
            <input type="checkbox" checked={o.attivo} onChange={(e) => setO({ ...o, attivo: e.target.checked })} />
            Attivo (compare in agenda e negli slot)
          </label>

          <h4>Skill</h4>
          <p className="tenue">
            Tocca per assegnare o togliere. Serve a proporre gli slot giusti; in prenotazione e in agenda si può comunque assegnare
            chiunque.
          </p>
          <div className="chips">
            {tutteLeSkill.map((k) => {
              const ha = o.competenze.includes(k);
              return (
                <button
                  key={k}
                  className={`chip${ha ? ' scelto' : ''}`}
                  onClick={() => setO({ ...o, competenze: ha ? o.competenze.filter((x) => x !== k) : [...o.competenze, k] })}
                >
                  {k}
                </button>
              );
            })}
            {/* skill dell'operatore non più in anagrafica: restano visibili per poterle togliere */}
            {o.competenze
              .filter((k) => !tutteLeSkill.includes(k))
              .map((k) => (
                <button key={k} className="chip scelto" onClick={() => setO({ ...o, competenze: o.competenze.filter((x) => x !== k) })}>
                  {k}
                </button>
              ))}
          </div>
          <div className="riga a-capo">
            <input
              placeholder="Nuova skill"
              value={nuovaOp}
              onChange={(e) => setNuovaOp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && creaSkillPerOperatore()}
            />
            <button disabled={!nuovaOp.trim()} onClick={creaSkillPerOperatore}>
              + Crea e assegna
            </button>
          </div>

          <h4>Turni settimanali</h4>
          {ORDINE_GIORNI.map((g) => {
            const t = o.turni[g];
            const modo = t == null ? 'salone' : t.length ? 'suo' : 'libero';
            return (
              <div className="riga a-capo giorno-riga" key={g}>
                <strong className="giorno-nome">{GIORNI[g]}</strong>
                <select
                  value={modo}
                  aria-label={`Turno di ${GIORNI[g]}`}
                  onChange={(e) =>
                    setTurno(
                      g,
                      e.target.value === 'salone'
                        ? null
                        : e.target.value === 'libero'
                          ? []
                          : imp.settimana[g].length
                            ? imp.settimana[g].map((f) => ({ ...f }))
                            : [{ da: 540, a: 780 }],
                    )
                  }
                >
                  <option value="salone">Come il salone</option>
                  <option value="suo">Orario personale</option>
                  <option value="libero">Non lavora</option>
                </select>
                {modo === 'suo' && <FasceEditor fasce={t!} onChange={(f) => setTurno(g, f)} vuoto="Non lavora" />}
              </div>
            );
          })}

          <h4>Ferie e assenze</h4>
          {o.assenze.map((a, i) => {
            const cambia = (pezzo: Partial<typeof a>) => setO({ ...o, assenze: o.assenze.map((x, j) => (j === i ? { ...x, ...pezzo } : x)) });
            return (
              <div className="assenza" key={i}>
                <div className="riga a-capo">
                  <SceltaData valore={a.dal} label="Assente dal" onChange={(d) => cambia({ dal: d, al: a.al < d ? d : a.al })} />
                  <span>–</span>
                  <SceltaData valore={a.al} min={a.dal} label="Assente fino al" onChange={(d) => cambia({ al: d })} />
                  <input className="cresce" placeholder="Motivo" value={a.nota} onChange={(e) => cambia({ nota: e.target.value })} />
                  <button className="icona" aria-label="Rimuovi assenza" onClick={() => setO({ ...o, assenze: o.assenze.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
                <div className="riga a-capo">
                  <label className="spunta">
                    <input
                      type="checkbox"
                      checked={a.da == null}
                      onChange={(e) => cambia(e.target.checked ? { da: undefined, a: undefined } : { da: 14 * 60, a: 16 * 60 })}
                    />
                    Tutto il giorno
                  </label>
                  {a.da != null && (
                    <>
                      <span>dalle</span>
                      <Ora valore={a.da} label="Assente dalle" onChange={(m) => cambia({ da: m })} />
                      <span>alle</span>
                      <Ora valore={a.a ?? a.da + 60} label="Assente fino alle" onChange={(m) => cambia({ a: m })} />
                      {(a.a ?? 0) <= a.da && <span className="etichetta gialla">la fine deve essere dopo l'inizio</span>}
                      {a.dal !== a.al && <span className="tenue">ogni giorno del periodo</span>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {!o.assenze.length && <p className="tenue">Nessuna assenza programmata.</p>}
          <button onClick={() => setO({ ...o, assenze: [...o.assenze, { dal: oggi(), al: oggi(), nota: '' }] })}>+ Aggiungi assenza</button>
          {o.assenze.some((a) => a.al < oggi()) && (
            <p className="tenue">Le assenze passate (fino al {dataNum(oggi())}) si possono rimuovere senza effetti.</p>
          )}
        </Modale>
      )}

      {inModifica && (
        <Modale
          titolo="Modifica skill"
          onChiudi={() => setInModifica(null)}
          azioni={
            <>
              <button className="pericolo" onClick={eliminaSkill}>
                Elimina
              </button>
              <span className="spazio" />
              <button className="primario" disabled={!inModifica.nome.trim()} onClick={salvaSkill}>
                Salva
              </button>
            </>
          }
        >
          <Campo etichetta="Nome" nota="Il nuovo nome viene applicato anche a operatori, servizi e appuntamenti che la usano.">
            <input value={inModifica.nome} onChange={(e) => setInModifica({ ...inModifica, nome: e.target.value })} />
          </Campo>
          {errore && <p className="avviso">{errore}</p>}
        </Modale>
      )}
    </div>
  );
}
