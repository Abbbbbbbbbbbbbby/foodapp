import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Registration failed'); return; }
      navigate('/verify', { state: { phone } });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Create Account / Crear cuenta</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Full name / Nombre completo
          <input type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Phone / Número de teléfono
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required autoComplete="tel" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary btn-large" disabled={loading || !name || !phone}>
          {loading ? 'Creating... / Creando...' : 'Create account / Crear cuenta'}
        </button>
      </form>
      <p>Already have an account? <Link to="/login">Sign in / Iniciar sesión</Link></p>
    </div>
  );
}
