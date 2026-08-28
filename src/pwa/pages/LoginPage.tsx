import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Set by Layout when a 401 bounced the user here (e.g. an expired
  // session) — one-time, not re-shown on a later manual visit to /login.
  const [notice] = useState<string | null>(() => (location.state as { message?: string } | null)?.message ?? null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Login failed'); return; }
      navigate('/verify', { state: { phone } });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Sign In / Iniciar sesión</h1>
      {notice && <p className="error banner">{notice}</p>}
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Phone / Número de teléfono
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            required
            autoComplete="tel"
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary btn-large" disabled={loading || !phone}>
          {loading ? 'Sending... / Enviando...' : 'Send code / Enviar código'}
        </button>
      </form>
      <p>No account? <Link to="/register">Create one / Crear cuenta</Link></p>
    </div>
  );
}
