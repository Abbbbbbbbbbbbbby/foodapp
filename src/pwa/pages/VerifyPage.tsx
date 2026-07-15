import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { setAuth } from '../store/auth';

export default function VerifyPage() {
  const location = useLocation();
  const phone = (location.state as { phone?: string })?.phone ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json() as {
        error?: string;
        token?: string;
        user?: { id: string; name: string; phone: string; role: 'admin' | 'staff' | 'volunteer' };
      };
      if (!res.ok) { setError(data.error ?? 'Verification failed'); return; }
      setAuth(data.token!, data.user!);
      navigate('/');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Enter code / Ingresar código</h1>
      <p>Code sent to {phone || 'your phone'}</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          6-digit code / Código de 6 dígitos
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary btn-large" disabled={loading || code.length < 6}>
          {loading ? 'Verifying... / Verificando...' : 'Verify / Verificar'}
        </button>
      </form>
    </div>
  );
}
