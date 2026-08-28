import { useState, useEffect, useRef } from 'react';
import { searchDirectory, type DirectoryFamily } from '../../lib/offline';
import { formatPhoneAsTyped } from '../../lib/phone';

interface LookupFormProps {
  onSearch: (name: string, phone: string | null) => Promise<void>;
}

export default function LookupForm({ onSearch }: LookupFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<DirectoryFamily[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSearch = name.trim().length > 0 || phone.trim().length > 0;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = name.trim();
    if (trimmed.length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchDirectory(trimmed, null);
        setSuggestions(results.slice(0, 5));
      } catch {
        setSuggestions([]);
      }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [name]);

  async function submit(searchName: string, searchPhone: string | null) {
    setSuggestions([]);
    setLoading(true);
    try {
      await onSearch(searchName, searchPhone);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    await submit(name.trim(), phone.trim() || null);
  }

  async function handleSelectSuggestion(f: DirectoryFamily) {
    setName(f.name);
    await submit(f.name, phone.trim() || null);
  }

  const dropdownItem: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '10px 14px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    fontSize: 15,
    color: 'var(--text)',
  };

  return (
    <form className="lookup-form" onSubmit={handleSubmit}>
      <h2>Who is picking up today? / ¿Quién está recogiendo hoy?</h2>
      <label>
        Name / Nombre
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          {suggestions.length > 0 && (
            <ul style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              marginTop: 4,
              padding: 0,
              listStyle: 'none',
              zIndex: 20,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}>
              {suggestions.map(f => (
                <li key={f.id} style={{ listStyle: 'none' }}>
                  <button type="button" style={dropdownItem} onClick={() => handleSelectSuggestion(f)}>
                    {f.name}
                    {f.num_people != null && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                        · {f.num_people} people
                      </span>
                    )}
                    {f.last_visit_date && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                        · last visit {f.last_visit_date}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      <label>
        Phone / Teléfono
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={e => setPhone(formatPhoneAsTyped(e.target.value))}
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
