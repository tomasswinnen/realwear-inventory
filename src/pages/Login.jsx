import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { LogoMark } from '../components/Logo';

// Autorregistro abierto SOLO para correos de la empresa. La validación de acá
// es UX; la de verdad es un trigger en Postgres sobre auth.users
// (SQL_auth_realwear.sql) que rechaza cualquier otro dominio aunque alguien
// llame a la API directo con la anon key.
const DOMINIO = '@realwear.com';

export function Login() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const session = useAuth();

  useEffect(() => {
    if (session) navigate('/', { replace: true });
  }, [session, navigate]);

  function cambiarModo(m) {
    setMode(m);
    setError('');
    setInfo('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');

    const mail = email.trim().toLowerCase();
    if (mode !== 'signin' && !mail.endsWith(DOMINIO)) {
      setError(`Use your ${DOMINIO} email.`);
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email: mail, password });
        if (err) {
          // El trigger de dominio en la base responde con un error genérico
          // de "Database error saving new user": traducirlo a algo útil.
          setError(/database error/i.test(err.message)
            ? `Sign up is restricted to ${DOMINIO} emails.`
            : err.message || 'Sign up failed.');
        } else if (data.session) {
          // Email confirmation disabled — signed in immediately.
        } else {
          setInfo('Check your email to confirm your account before signing in.');
        }
      } else if (mode === 'reset') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(mail, {
          redirectTo: `${window.location.origin}/update-password`,
        });
        if (err) setError(err.message || 'Could not send the reset email.');
        else setInfo('Check your email for the password reset link.');
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: mail, password });
        if (err) setError(err.message || 'Login failed. Check your credentials.');
      }
    } catch {
      setError('Connection error — check console for details.');
    }
    setLoading(false);
  }

  const titulo = mode === 'signup' ? 'Create account'
    : mode === 'reset' ? 'Reset password'
    : 'Sign in';
  const accion = loading
    ? (mode === 'signup' ? 'Creating account…' : mode === 'reset' ? 'Sending…' : 'Signing in…')
    : (mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in');

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <LogoMark className="w-8 h-8 text-white" />
          <span className="font-sans font-semibold text-white text-base tracking-wide">
            Inventory
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#0d1620] border border-white/[0.08] rounded-lg p-6 space-y-4"
        >
          <h1 className="text-white font-semibold text-lg font-sans">{titulo}</h1>

          {mode === 'signup' && (
            <p className="text-xs text-slate-400 font-sans">
              Anyone with a <span className="text-slate-200 font-medium">{DOMINIO}</span> email
              can create an account.
            </p>
          )}

          <div className="space-y-1">
            <label className="text-xs text-slate-400 font-sans">Email</label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#0f1923] border border-white/[0.10] rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent"
              placeholder="you@realwear.com"
            />
          </div>

          {mode !== 'reset' && (
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-sans">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#0f1923] border border-white/[0.10] rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <p className="text-red-400 text-xs font-sans">{error}</p>
          )}
          {info && (
            <p className="text-emerald-400 text-xs font-sans">{info}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-sans font-medium text-sm rounded px-4 py-2 transition-colors"
          >
            {accion}
          </button>

          <div className="space-y-1.5">
            <p className="text-center text-xs text-slate-400 font-sans">
              {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => cambiarModo(mode === 'signup' ? 'signin' : 'signup')}
                className="text-accent hover:underline font-medium"
              >
                {mode === 'signup' ? 'Sign in' : 'Create one'}
              </button>
            </p>
            {mode === 'signin' && (
              <p className="text-center text-xs text-slate-500 font-sans">
                <button
                  type="button"
                  onClick={() => cambiarModo('reset')}
                  className="hover:text-slate-300 hover:underline"
                >
                  Forgot password?
                </button>
              </p>
            )}
            {mode === 'reset' && (
              <p className="text-center text-xs text-slate-500 font-sans">
                <button
                  type="button"
                  onClick={() => cambiarModo('signin')}
                  className="hover:text-slate-300 hover:underline"
                >
                  Back to sign in
                </button>
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
