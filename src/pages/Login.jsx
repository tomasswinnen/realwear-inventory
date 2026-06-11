import { useState } from 'react';
import { supabase } from '../lib/supabase';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setLoading(false);
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
          <h1 className="text-white font-semibold text-lg font-sans">Sign in</h1>

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
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#0f1923] border border-white/[0.10] rounded px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-accent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-400 text-xs font-sans">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-sans font-medium text-sm rounded px-4 py-2 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
