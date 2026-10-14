import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Seguimiento de renovaciones, compartido por Subscriptions y Warranties.
// Cada página tiene su tabla (subscription_followup / warranty_followup), con
// una fila por serial: estado + nota + quién/cuándo. El estado vale solo para
// la end_date con la que se marcó: cuando entra la renovación (nueva fecha de
// fin) el contrato nuevo arranca "Not contacted" solo.

export const SEGUIMIENTO = {
  open: { label: 'Not contacted', cls: 'bg-white/[0.07] text-slate-300' },
  contacted: { label: 'Contacted', cls: 'bg-accent/15 text-accent' },
  quoted: { label: 'Quote sent', cls: 'bg-accent/25 text-white' },
  renewed: { label: 'Renewed', cls: 'bg-success/15 text-success' },
  lost: { label: 'Lost', cls: 'bg-danger/15 text-danger' },
};
export const segLabel = s => SEGUIMIENTO[s]?.label ?? (s === 'mixed' ? 'Mixed' : s);

export const normSerial = s => (s ?? '').trim().toUpperCase();

// Seguimiento vigente de un serial: solo si se marcó para ESTA fecha de fin.
export function seguimientoDe(mapa, serial, endDate) {
  const f = mapa.get(normSerial(serial));
  return f && f.end_date === endDate ? f : null;
}

// Resumen de un grupo de seriales: estado común (o 'mixed') y la última nota.
export function resumenSeguimiento(regs) {
  const estados = [...new Set(regs.map(r => r.fu?.status ?? 'open'))];
  const ultimo = regs.map(r => r.fu).filter(Boolean)
    .sort((a, b) => ((a.updated_at ?? '') < (b.updated_at ?? '') ? 1 : -1))[0] ?? null;
  return {
    seguimiento: estados.length === 1 ? estados[0] : 'mixed',
    nota: ultimo?.note ?? '',
    fuBy: ultimo?.updated_by ?? null,
    fuAt: ultimo?.updated_at ?? null,
  };
}

// Guarda el estado para todos los seriales del contrato. Devuelve las filas
// guardadas para que la página las aplique sin recargar todo.
export async function guardarSeguimiento(tabla, regs, estado, nota) {
  const { data: u } = await supabase.auth.getUser();
  const by = u?.user?.email ?? null;
  const ahora = new Date().toISOString();
  const porSerial = new Map();
  for (const r of regs) {
    porSerial.set(normSerial(r.serial), {
      serial: r.serial, end_date: r.end_date, status: estado,
      note: nota || null, updated_by: by, updated_at: ahora,
    });
  }
  const filas = [...porSerial.values()];
  const { error } = await supabase.from(tabla).upsert(filas, { onConflict: 'serial' });
  if (error) throw new Error(error.message);
  return filas;
}

export function descargarCSV(filas, nombre) {
  const cols = Object.keys(filas[0] ?? { 'No contracts': '' });
  const esc = v => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const txt = [cols.map(esc).join(','), ...filas.map(f => cols.map(c => esc(f[c])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Pastilla de estado para la fila del contrato.
export function SeguimientoPill({ c }) {
  return (
    <span title={c.fuAt ? `${segLabel(c.seguimiento)} — ${c.fuBy ?? '?'} · ${c.fuAt.slice(0, 10)}${c.nota ? `\n${c.nota}` : ''}` : 'No follow-up yet'}
      className={`font-mono text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${SEGUIMIENTO[c.seguimiento]?.cls ?? 'bg-white/[0.07] text-slate-300'}`}>
      {segLabel(c.seguimiento)}
    </span>
  );
}

// Chips para filtrar por estado de seguimiento (con conteos).
export function SeguimientoFiltro({ seg, setSeg, conteo }) {
  return (
    <>
      <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Follow-up</span>
      {[['any', 'Any'], ...Object.entries(SEGUIMIENTO).map(([k, s]) => [k, s.label]), ['mixed', 'Mixed']]
        .filter(([k]) => k === 'any' || (conteo?.[k] ?? 0) > 0 || seg === k)
        .map(([k, label]) => (
          <button key={k} onClick={() => setSeg(k)}
            className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
              seg === k ? (SEGUIMIENTO[k]?.cls ?? 'bg-accent/15 text-accent') : 'text-muted hover:text-white'}`}>
            {label}{conteo ? <span className="opacity-60"> · {conteo[k] ?? 0}</span> : null}
          </button>
        ))}
    </>
  );
}

// Editor: estado + nota, guarda para todos los seriales del contrato.
// Montarlo con key que incluya fuAt/seguimiento para que se reinicie al guardar.
export function SeguimientoEditor({ c, onGuardar, sinTabla }) {
  const inicial = c.seguimiento === 'mixed' ? 'open' : c.seguimiento;
  const [estado, setEstado] = useState(inicial);
  const [nota, setNota] = useState(c.nota ?? '');
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState('');
  const cambiado = estado !== c.seguimiento || nota.trim() !== (c.nota ?? '');
  const guardar = async () => {
    setGuardando(true); setErr('');
    try { await onGuardar(c, estado, nota.trim()); } catch (e) { setErr(e.message); setGuardando(false); }
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap px-4 pl-10 pb-2">
      <span className="text-[10px] font-mono text-muted uppercase tracking-wider mr-1">Follow-up</span>
      {Object.entries(SEGUIMIENTO).map(([k, s]) => (
        <button key={k} onClick={() => setEstado(k)} disabled={sinTabla}
          className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors disabled:opacity-40 ${
            estado === k ? `${s.cls} ring-1 ring-white/20` : 'text-muted hover:text-white'}`}>
          {s.label}
        </button>
      ))}
      <input value={nota} onChange={e => setNota(e.target.value)} maxLength={300} disabled={sinTabla}
        onKeyDown={e => { if (e.key === 'Enter' && cambiado && !guardando) guardar(); }}
        placeholder="Note — who you talked to, quote #, next step…"
        className="flex-1 min-w-[220px] bg-white/[0.03] border border-white/[0.1] rounded px-2 py-1 text-[11px] font-sans text-white placeholder:text-muted focus:outline-none focus:border-accent/50 disabled:opacity-40" />
      <button onClick={guardar} disabled={!cambiado || guardando || sinTabla}
        className="px-2.5 py-1 rounded bg-accent text-white text-[10px] font-mono hover:bg-accent/80 disabled:opacity-30 transition-colors">
        {guardando ? 'Saving…' : 'Save'}
      </button>
      {c.fuAt && (
        <span className="text-[10px] font-mono text-muted">
          last update {c.fuBy ?? '?'} · {c.fuAt.slice(0, 10)}{c.seguimiento === 'mixed' ? ' · devices have different statuses' : ''}
        </span>
      )}
      {sinTabla && <span className="text-[10px] font-mono text-warning">follow-up table not created yet</span>}
      {err && <span className="text-[10px] font-mono text-danger">Not saved: {err}</span>}
    </div>
  );
}
