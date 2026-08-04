import { useState, useRef } from 'react';
import type { FamilySearchResult, WizardFormData, ProxyData } from '../lib/types';
import { api, ApiError } from '../lib/api';
import { queueItem, generateUUID } from '../lib/offline';
import { localDateString } from '../lib/date';
import LookupForm from '../components/enter/LookupForm';
import ResultsList from '../components/enter/ResultsList';
import FamilySelectScreen from '../components/enter/FamilySelectScreen';
import LogVisitScreen from '../components/enter/LogVisitScreen';
import HowManyFamilies from '../components/enter/HowManyFamilies';
import ProxyQuestion from '../components/enter/ProxyQuestion';
import Wizard from '../components/wizard/Wizard';
import SummaryScreen, { type SummaryFamily } from '../components/enter/SummaryScreen';

type EnterView =
  | { type: 'lookup' }
  | { type: 'results'; results: FamilySearchResult[]; searchName: string; searchPhone: string | null }
  | { type: 'family-select'; own: FamilySearchResult | null; proxy: FamilySearchResult[] }
  | { type: 'log-visit'; families: FamilySearchResult[]; current: number }
  | { type: 'how-many'; searchName: string; searchPhone: string | null }
  | { type: 'proxy-question'; familyIndex: number; total: number; prefillName: string; prefillPhone: string | null }
  | { type: 'wizard'; familyIndex: number; total: number; initialData: Partial<WizardFormData>; proxyData: ProxyData | null }
  | { type: 'done'; families: SummaryFamily[]; error?: string };

export default function EnterPage() {
  const [view, setView] = useState<EnterView>({ type: 'lookup' });
  const [error, setError] = useState<string | null>(null);
  // Accumulates new families across multiple wizard completions for the summary screen
  const pendingFamilies = useRef<SummaryFamily[]>([]);
  // Accumulates visit IDs for the log-visit (existing family) flow
  const pendingVisitIds = useRef<{ visitId: string | null; queueId: string | null }[]>([]);

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
      // URLSearchParams not in Safari 9 — build query string manually
      const qs: string[] = [];
      if (name) qs.push('name=' + encodeURIComponent(name));
      if (phone) qs.push('phone=' + encodeURIComponent(phone));
      const { results } = await api.get<{ results: FamilySearchResult[] }>(
        '/api/families/search' + (qs.length ? '?' + qs.join('&') : '')
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
    pendingVisitIds.current = [];
    setView({ type: 'log-visit', families, current: 0 });
  }

  async function handleLogVisit(familyId: string) {
    if (view.type !== 'log-visit') return;
    const { families, current } = view;
    const visitIdemKey = generateUUID();
    const visitPayload = {
      family_id: familyId,
      visit_date: localDateString(),
      idempotency_key: visitIdemKey,
    };
    let visitId: string | null = null;
    let queueId: string | null = null;
    try {
      const result = await api.post<{ id: string }>('/api/visits', visitPayload);
      visitId = result.id;
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        return; // server rejected — don't advance, let user see the error
      }
      // Network error — queue with the same idempotency key and continue
      try {
        queueId = await queueItem({ type: 'visit', payload: { family_id: familyId, visit_date: visitPayload.visit_date } }, visitIdemKey);
      } catch {
        setError('Unable to save offline. Check storage permissions and try again.');
        return;
      }
    }
    pendingVisitIds.current.push({ visitId, queueId });
    if (current + 1 < families.length) {
      setView({ type: 'log-visit', families, current: current + 1 });
    } else {
      const visitRefs = pendingVisitIds.current;
      pendingVisitIds.current = [];
      setView({
        type: 'done',
        families: families.map((f, i) => ({
          id: f.id,
          name: f.name,
          num_people: f.num_people,
          bag_received: null,
          visitId: visitRefs[i]?.visitId ?? null,
          queueId: visitRefs[i]?.queueId ?? null,
        })),
      });
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
    setError(null);

    const today = localDateString();
    const familyPayload = {
      ...data,
      first_visit_date: today,
      proxy: proxyData ?? undefined,
    };
    // Generate both keys before the first attempt so the server can de-dup
    // even if the network drops after it committed but before the reply arrived.
    const familyIdemKey = generateUUID();
    const visitIdemKey = generateUUID();

    // --- POST family ---
    let familyId: string;
    try {
      const result = await api.post<{ id: string }>('/api/families', {
        ...familyPayload,
        idempotency_key: familyIdemKey,
      });
      familyId = result.id;
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        return; // server rejected — don't advance
      }
      // Network error — queue family + visit pair together and advance
      let familyQueueId: string;
      try {
        familyQueueId = await queueItem({ type: 'family', payload: { data: familyPayload, proxyData } }, familyIdemKey);
      } catch {
        setError('Unable to save offline. Check storage permissions and try again.');
        return;
      }
      pendingFamilies.current.push({ id: '', name: data.name, num_people: data.num_people ?? null, bag_received: null, visitId: null, queueId: familyQueueId });
      advanceWizard(familyIndex, total);
      return;
    }

    // --- POST visit (family already committed to DB with real id) ---
    const visitPayload = {
      family_id: familyId,
      visit_date: today,
      picked_up_by_phone: proxyData?.proxy_phone ?? null,
    };
    let visitId: string | null = null;
    let visitQueueId: string | null = null;
    let visitError: string | undefined;
    try {
      const visitResult = await api.post<{ id: string }>('/api/visits', { ...visitPayload, idempotency_key: visitIdemKey });
      visitId = visitResult.id;
    } catch (e) {
      if (e instanceof ApiError) {
        // Family saved — still advance but surface the error
        visitError = `Family saved, but visit log failed: ${e.message}`;
      } else {
        // Network — queue only the visit (family already has an id)
        try {
          visitQueueId = await queueItem({ type: 'visit', payload: visitPayload }, visitIdemKey);
        } catch {
          visitError = 'Visit not saved offline. Check storage permissions.';
        }
      }
    }

    pendingFamilies.current.push({ id: familyId, name: data.name, num_people: data.num_people ?? null, bag_received: null, visitId, queueId: visitQueueId });
    advanceWizard(familyIndex, total, visitError);
  }

  function advanceWizard(familyIndex: number, total: number, pendingError?: string) {
    if (familyIndex + 1 < total) {
      // Surface any visit error before moving to next wizard entry
      if (pendingError) setError(pendingError);
      setView({
        type: 'proxy-question',
        familyIndex: familyIndex + 1,
        total,
        prefillName: '',
        prefillPhone: null,
      });
    } else {
      const families = pendingFamilies.current;
      pendingFamilies.current = [];
      // Pass any error into the done view so it renders on the summary screen
      setView({ type: 'done', families, error: pendingError });
    }
  }

  if (view.type === 'done') {
    return (
      <div className="enter-page">
        {view.error && <p className="error banner">{view.error}</p>}
        <SummaryScreen
          families={view.families}
          onNext={() => setView({ type: 'lookup' })}
        />
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
          familyIndex={view.familyIndex}
          total={view.total}
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
