import type { FamilySearchResult } from '../../lib/types';

interface ResultsListProps {
  results: FamilySearchResult[];
  onSelect: (result: FamilySearchResult) => void;
  onRegisterNew: () => void;
  onBack: () => void;
}

export default function ResultsList({ results, onSelect, onRegisterNew, onBack }: ResultsListProps) {
  return (
    <div className="results-list">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <button className="btn-ghost" style={{ marginRight: 12 }} onClick={onBack}>← Back</button>
        <h2>Results / Resultados ({results.length})</h2>
      </div>
      {results.map(r => (
        <button key={r.id} className="result-card" onClick={() => onSelect(r)}>
          <span className="result-name">{r.name}</span>
          <span className="result-meta">
            {r.phone ? `···${r.phone.slice(-4)}` : 'No phone'}
            {' · '}
            {r.num_people ?? '?'} people
            {r.last_visit_date
              ? ` · Last visit: ${r.last_visit_date}`
              : ' · First visit'}
          </span>
        </button>
      ))}
      <button className="btn-secondary btn-large" style={{ marginTop: 8 }} onClick={onRegisterNew}>
        Not the right person → Register as new
        {' / '}
        No es la persona → Registrar como nuevo
      </button>
    </div>
  );
}
