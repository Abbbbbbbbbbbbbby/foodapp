import { useState } from 'react';
import type { FamilySearchResult, WizardFormData, ProxyData } from '../lib/types';
import { api, ApiError } from '../lib/api';
import { queueItem } from '../lib/offline';
import LookupForm from '../components/enter/LookupForm';
import ResultsList from '../components/enter/ResultsList';
import FamilySelectScreen from '../components/enter/FamilySelectScreen';
import LogVisitScreen from '../components/enter/LogVisitScreen';
import HowManyFamilies from '../components/enter/HowManyFamilies';
import ProxyQuestion from '../components/enter/ProxyQuestion';
import Wizard from '../components/wizard/Wizard';

type EnterView =
  | { type: 'lookup' }
  | { type: 'results'; results: FamilySearchResult[]; searchName: string; searchPhone: string | null }
  | { type: 'family-select'; own: FamilySearchResult | null; proxy: FamilySearchResult[] }
  | { type: 'log-visit'; families: FamilySearchResult[]; current: number }
  | { type: 'how-many'; searchName: string; searchPhone: string | null }
  | { type: 'proxy-question'; familyIndex: number; total: number; prefillName: string; prefillPhone: string | null }
  | { type: 'wizard'; familyIndex: number; total: number; initialData: Partial<WizardFormData>; proxyData: ProxyData | null }
  | { type: 'done' };

export default function EnterPage() {
  const [view, setView] = useState<EnterView>({ type: 'lookup' });
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(name: string, phone: string | null) {
    setError(null);
    try {
      if (phone) {
        const pickup = await api.get<{ own: FamilySearchResult | null; proxy: FamilySearchResult[] }>(
          `/api/families/pickup?phone=${encodeURIComponent(phone)}`
        );
        if (pickup.own || pickup.proxy.length > 0) {
          setView({ type: 'family-select', own: pickup.own, proxy: pickup.proxy });
          return;
        }
      }
      const params = new URLSearchParams();
      if (name) params.set('name', name);
      if (phone) params.set('phone', phone);
      const { results } = await api.get<{ results: FamilySearchResult[] }>(
        `/api/families/search?${params}`
      );
      if (results.length === 0) {
        setView({ type: 'how-many', searchName: name, searchPhone: phone });
      } else {
        setView({ type: 'results', results, searchName: name, searchPhone: phone });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Network error. Check connection and try again.');
    }
  }

  async function handleSelectResult(result: FamilySearchResult) {
    if (result.phone) {
      try {
        const pickup = await api.get<{ own: FamilySearchResult | null; proxy: FamilySearchResult[] }>(
          `/api/families/pickup?phone=${encodeURIComponent(result.phone)}`
        );
        setView({ type: 'family-select', own: pickup.own ?? result, proxy: pickup.proxy });
        return;
      } catch { /* fall through to single-family select */ }
    }
    setView({ type: 'family-select', own: result, proxy: [] });
  }

  function handleFamilySelectConfirm(families: FamilySearchResult[]) {
    if (families.length === 0) return;
    setView({ type: 'log-visit', families, current: 0 });
  }

  async function handleLogVisit(familyId: string) {
    if (view.type !== 'log-visit') return;
    const { families, current } = view;
    try {
      await api.post('/api/visits', {
        family_id: familyId,
        visit_date: new Date().toISOString().slice(0, 10),
      });
    } catch {
      await queueItem({ type: 'visit', payload: { family_id: familyId, visit_date: new Date().toISOString().slice(0, 10) } });
    }
    if (current + 1 < families.length) {
      setView({ type: 'log-visit', families, current: current + 1 });
    } else {
      setView({ type: 'done' });
    }
  }

  function handleHowMany(count: number) {
    if (view.type !== 'how-many') return;
    setView({
      type: 'proxy-question',
      familyIndex: 0,
      total: count,
      prefillName: view.searchName,
      prefillPhone: view.searchPhone,
    });
  }

  function handleProxyAnswer(proxyData: ProxyData | null) {
    if (view.type !== 'proxy-question') return;
    setView({
      type: 'wizard',
      familyIndex: view.familyIndex,
      total: view.total,
      initialData: { name: view.prefillName, phone: view.prefillPhone },
      proxyData,
    });
  }

  async function handleWizardComplete(data: WizardFormData, proxyData: ProxyData | null) {
    if (view.type !== 'wizard') return;
    const { familyIndex, total } = view;
    try {
      const { id } = await api.post<{ id: string }>('/api/families', {
        ...data,
        first_visit_date: new Date().toISOString().slice(0, 10),
        proxy: proxyData ?? undefined,
      });
      await api.post('/api/visits', {
        family_id: id,
        visit_date: new Date().toISOString().slice(0, 10),
        picked_up_by_phone: proxyData?.proxy_phone ?? null,
      });
    } catch {
      await queueItem({ type: 'family', payload: { data, proxyData } });
    }
    if (familyIndex + 1 < total) {
      setView({
        type: 'proxy-question',
        familyIndex: familyIndex + 1,
        total,
        prefillName: '',
        prefillPhone: null,
      });
    } else {
      setView({ type: 'done' });
    }
  }

  if (view.type === 'done') {
    return (
      <div className="enter-page done">
        <h2>Done / Listo ✓</h2>
        <p>Visit recorded / Visita registrada</p>
        <button className="btn-primary btn-large" onClick={() => setView({ type: 'lookup' })}>
          Next person / Siguiente persona
        </button>
      </div>
    );
  }

  return (
    <div className="enter-page">
      {error && <p className="error banner">{error}</p>}

      {view.type === 'lookup' && (
        <LookupForm onSearch={handleSearch} />
      )}
      {view.type === 'results' && (
        <ResultsList
          results={view.results}
          onSelect={handleSelectResult}
          onRegisterNew={() => {
            if (view.type === 'results') {
              setView({ type: 'how-many', searchName: view.searchName, searchPhone: view.searchPhone });
            }
          }}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'family-select' && (
        <FamilySelectScreen
          own={view.own}
          proxy={view.proxy}
          onConfirm={handleFamilySelectConfirm}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'log-visit' && (
        <LogVisitScreen
          family={view.families[view.current]}
          total={view.families.length}
          current={view.current}
          onLogVisit={handleLogVisit}
        />
      )}
      {view.type === 'how-many' && (
        <HowManyFamilies
          onSelect={handleHowMany}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'proxy-question' && (
        <ProxyQuestion
          prefillName={view.prefillName}
          prefillPhone={view.prefillPhone}
          onAnswer={handleProxyAnswer}
          onBack={() => {
            if (view.type === 'proxy-question') {
              setView({ type: 'how-many', searchName: view.prefillName, searchPhone: view.prefillPhone });
            }
          }}
        />
      )}
      {view.type === 'wizard' && (
        <Wizard
          familyIndex={view.familyIndex}
          total={view.total}
          initialData={view.initialData}
          proxyData={view.proxyData}
          onComplete={handleWizardComplete}
          onBack={() => {
            if (view.type === 'wizard') {
              setView({
                type: 'proxy-question',
                familyIndex: view.familyIndex,
                total: view.total,
                prefillName: view.initialData.name ?? '',
                prefillPhone: view.initialData.phone ?? null,
              });
            }
          }}
        />
      )}
    </div>
  );
}
