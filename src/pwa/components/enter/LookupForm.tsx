import { useState } from 'react';

interface LookupFormProps {
  onSearch: (name: string, phone: string | null) => Promise<void>;
}

export default function LookupForm({ onSearch }: LookupFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const canSearch = name.trim().length > 0 || phone.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    try {
      await onSearch(name.trim(), phone.trim() || null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="lookup-form" onSubmit={handleSubmit}>
      <h2>Who is picking up today? / ¿Quién está recogiendo hoy?</h2>
      <label>
        Name / Nombre
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      </label>
      <label>
        Phone / Teléfono
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          autoComplete="off"
        />
      </label>
      <button
        type="submit"
        className="btn-primary btn-large"
        disabled={loading || !canSearch}
      >
        {loading ? 'Searching... / Buscando...' : 'Search / Buscar'}
      </button>
    </form>
  );
}
