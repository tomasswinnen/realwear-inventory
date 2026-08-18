import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import brandMark from '../assets/realwear-brand-mark-white.svg';
import wordmark from '../assets/realwear-wordmark-white.svg';

export function Login() {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
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

  function toggleMode() {
    setMode(m => (m === 'signin' ? 'signup' : 'signin'));
    setError('');
    setInfo('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) {
          setError(err.message || 'Sign up failed.');
        } else if (data.session) {
          // Email confirmation disabled — signed in immediately.
        } else {
          setInfo('Check your email to confirm your account before signing in.');
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) setError(err.message || 'Login failed. Check your credentials.');
      }
    } catch {
      setError('Connection error — check console for details.');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#0f1923] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={brandMark} alt="" className="w-10 h-10" />
          <div className="flex flex-col items-center gap-1">
            <img src={wordmark} alt="RealWear" className="h-4 w-auto" />
            <span className="text-[10px] text-muted font-mono uppercase tracking-widest">
              Inventory
            </span>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#0d1620] border border-white/[0.08] rounded-lg p-6 space-y-4"
        >
          <h1 className="text-white font-semibold text-lg font-sans">
            {mode === 'signup' ? 'Create account' : 'Sign in'}
          </h1>

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
            {loading
              ? mode === 'signup' ? 'Creating account…' : 'Signing in…'
              : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>

          <p className="text-center text-xs text-slate-400 font-sans">
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="text-accent hover:underline font-medium"
            >
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
