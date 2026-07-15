import { useState } from 'react';
import type { FamilySearchResult } from '../../lib/types';

interface LogVisitScreenProps {
  family: FamilySearchResult;
  total: number;
  current: number;
  onLogVisit: (familyId: string) => Promise<void>;
}

export default function LogVisitScreen({ family, total, current, onLogVisit }: LogVisitScreenProps) {
  const [loading, setLoading] = useState(false);

  async function handleNoChange() {
    setLoading(true);
    await onLogVisit(family.id);
    setLoading(false);
  }

  return (
    <div className="log-visit">
      <p className="progress-label">Family {current + 1} of {total}</p>
      <div className="family-info-card">
        <h2>{family.name}</h2>
        {family.num_people && <p>{family.num_people} people in household</p>}
        {family.last_visit_date && <p>Last visit: {family.last_visit_date}</p>}
        {!family.last_visit_date && <p>First visit today</p>}
      </div>
      <div className="log-actions">
        <button className="btn-primary btn-large" onClick={handleNoChange} disabled={loading}>
          {loading ? 'Saving...' : 'No change / Sin cambios'}
        </button>
      </div>
    </div>
  );
}
