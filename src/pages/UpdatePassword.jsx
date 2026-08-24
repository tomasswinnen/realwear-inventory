import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// Página a la que llega el link de "reset password" del correo. El link de
// Supabase trae un token que el cliente convierte en sesión automáticamente
// (detectSessionInUrl), así que acá el usuario ya está autenticado y solo
// falta que elija la contraseña nueva.
export function UpdatePassword() {
  const session = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  if (session === undefined) return null; // cargando
  if (!session) return <Navigate to="/login" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) setError(err.message || 'Could not update the password.');
    else navigate('/', { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-7 h-7 bg-accent rounded flex items-center justify-center">
            <span className="text-white font-bold text-xs font-mono">RW</span>
          </div>
          <span className="font-sans font-semibold text-white text-base tracking-wide">
            Inventory
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#0d1620] border border-white/[0.08] rounded-lg p-6 space-y-4"
        >
          <h1 className="text-white font-semibold text-lg font-sans">Choose a new password</h1>

          <div className="space-y-1">
            <label className="text-xs text-slate-400 font-sans">New password</label>
            <input
              type="password"
              required
              minLength={6}
              autoFocus
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#0f1923] border border-white/[0.10] rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent"
              placeholder="••••••••"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-slate-400 font-sans">Repeat it</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full bg-[#0f1923] border border-white/[0.10] rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-red-400 text-xs font-sans">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-sans font-medium text-sm rounded px-4 py-2 transition-colors"
          >
            {loading ? 'Saving…' : 'Save and continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
