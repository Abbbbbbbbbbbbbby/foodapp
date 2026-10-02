import { useState, useRef, useEffect } from 'react';
import type { FamilySearchResult, WizardFormData, ProxyData, EnterView } from '../lib/types';
import { api, apiWithToken, ApiError } from '../lib/api';
import { queueItem, generateUUID, searchDirectory, directoryPickup, upsertDirectoryFamilies, markDirectoryStale } from '../lib/offline';
import type { DirectoryFamily } from '../lib/offline';
import { normalizeName, normalizePhone } from '../../shared/fuzzy';
import { getAuth } from '../store/auth';
import { localDateString } from '../lib/date';
import { saveDraftNow, saveDraftDebounced, loadDraft, deleteDraft } from '../lib/draft';
import type { EntryDraft, PendingVisitRef } from '../lib/draft';
import { trackEvent, setTelemetryContext } from '../lib/telemetry';
import LookupForm from '../components/enter/LookupForm';
import ResultsList from '../components/enter/ResultsList';
import FamilySelectScreen from '../components/enter/FamilySelectScreen';
import LogVisitScreen from '../components/enter/LogVisitScreen';
import HowManyFamilies from '../components/enter/HowManyFamilies';
import ConsentScreen from '../components/enter/ConsentScreen';
import ProxyIntroScreen from '../components/enter/ProxyIntroScreen';
import ProxyEntryForm from '../components/enter/ProxyEntryForm';
import Wizard from '../components/wizard/Wizard';
import SummaryScreen, { type SummaryFamily } from '../components/enter/SummaryScreen';


// Explicit, field-by-field lift of a cached directory row into the
// FamilySearchResult contract the select/log-visit screens consume. Every
// Family field is enumerated so the compiler flags this site when the
// contract grows — a blanket cast would silently hand new fields undefined.
function directoryToSearchResult(f: DirectoryFamily): FamilySearchResult {
  return {
    id: f.id, name: f.name, phone: f.phone, num_people: f.num_people,
    last_visit_date: f.last_visit_date,
    address: null, zip_code: null, date_of_birth: null, language: null,
    ethnicity: null, hispanic: null, ami_bracket: null,
    num_children_under_18: null, num_children_under_5: null,
    num_with_diabetes: null, health_insurance: null, snap_benefits: null,
    receives_texts: null, want_text_updates: null, id_confirmed: null,
    bag_received: null, first_visit_date: null, created_by: null,
    created_at: '', updated_at: '',
  };
}

export default function EnterPage() {
  const [view, setView] = useState<EnterView>({ type: 'lookup' });
  // The identity this page was opened under. Submission handlers refuse to
  // run for anyone else — defense in depth behind the account-change
  // overlay, so no focus-management gap can submit a draft as another user.
  const [mountUserId] = useState(() => getAuth()?.user.id);
  const [error, setError] = useState<string | null>(null);
  // Set when a search failed for connectivity reasons: offers the offline
  // continue path (without it, a dead network strands the volunteer at the
  // lookup and the offline queue is unreachable).
  const [offlineSearch, setOfflineSearch] = useState<{ name: string; phone: string | null } | null>(null);
  // Accumulates new families across multiple wizard completions for the summary screen
  const pendingFamilies = useRef<SummaryFamily[]>([]);
  // Accumulates visit IDs for the log-visit (existing family) flow
  const pendingVisitIds = useRef<PendingVisitRef[]>([]);

  // Draft persistence (issue #12): a resumable snapshot of this in-progress
  // entry, so a crash/reload/tab-discard mid-wizard doesn't lose it.
  // draftReady gates every write until the mount-time draft check resolves —
  // otherwise the initial {type:'lookup'} render (which never writes, per
  // the carve-out below) races a real draft-check finish and could clobber
  // it before the resume prompt is even offered.
  const draftReady = useRef(false);
  const [resumePrompt, setResumePrompt] = useState<{ draft: EntryDraft } | null>(null);
  // The wizard's OWN step/data live in Wizard's component state, invisible
  // to EnterPage except through this callback-populated ref — needed both
  // to snapshot a draft mid-wizard and to know when a resumed wizard should
  // seed itself back to the right step.
  const currentWizardStateRef = useRef<{ step: number; data: Partial<WizardFormData> } | null>(null);
  const wizardPrevStepRef = useRef<number | null>(null);
  // Restored wizard seed data, consumed exactly once by the Wizard render
  // that follows a resume — cleared in the [view] effect right after that
  // render commits, so a later family's wizard in the same multi-family
  // loop doesn't inherit a stale step.
  const restoredWizardRef = useRef<{ initialData: Partial<WizardFormData>; initialStep: number } | null>(null);
  // In-flight submission idempotency keys — see mintOrReuseKey below.
  const submissionKeysRef = useRef<{ familyIdemKey?: string; visitIdemKey?: string }>({});
  // Who may pick up for EVERY family in this registration batch — decided
  // ONCE via proxy-intro/proxy-entry, not re-asked per family. Always
  // includes the person entered at lookup; additional entries appended if
  // "yes, someone else too" was answered.
  const batchProxiesRef = useRef<{ name: string; phone: string | null }[]>([]);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  function buildDraft(viewToSave: EnterView): EntryDraft | null {
    if (!mountUserId) return null;
    const keys = submissionKeysRef.current;
    return {
      user_id: mountUserId,
      updatedAt: Date.now(),
      view: viewToSave,
      wizard: currentWizardStateRef.current,
      pendingSubmission: Object.keys(keys).length > 0 ? keys : null,
      pendingFamilies: pendingFamilies.current,
      pendingVisitIds: pendingVisitIds.current,
    };
  }

  async function persistDraftNow(viewToSave: EnterView): Promise<void> {
    const draft = buildDraft(viewToSave);
    if (draft) await saveDraftNow(draft);
  }

  // Reuses the SAME idempotency key across a crash-resume for a submission
  // that may already have committed server-side — the server's existing
  // idempotency handling then makes the retry a safe no-op instead of a
  // duplicate family/visit. Cleared once the family+visit pair this key
  // belongs to is fully resolved (success OR safely offline-queued — the
  // offline queue has its own independent idempotency guarantee), so the
  // NEXT family in a multi-family loop mints its own fresh key.
  function mintOrReuseKey(kind: 'familyIdemKey' | 'visitIdemKey'): string {
    const existing = submissionKeysRef.current[kind];
    if (existing) return existing;
    const fresh = generateUUID();
    submissionKeysRef.current = { ...submissionKeysRef.current, [kind]: fresh };
    return fresh;
  }

  function clearSubmissionKey(kind: 'familyIdemKey' | 'visitIdemKey'): void {
    const next = { ...submissionKeysRef.current };
    delete next[kind];
    submissionKeysRef.current = next;
  }

  function draftDisplayName(v: EnterView): string {
    switch (v.type) {
      case 'results': return v.searchName;
      case 'family-select': return v.pickupName;
      case 'inline-register': return v.prefillName;
      case 'log-visit': return v.families[v.current]?.name ?? '';
      case 'how-many': return v.searchName;
      case 'proxy-intro': return v.searchName;
      case 'proxy-entry': return v.searchName;
      case 'consent': return v.searchName;
      case 'wizard': return v.initialData.name ?? '';
      default: return '';
    }
  }

  // Mount-time draft check.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!mountUserId) { draftReady.current = true; return; }
      const draft = await loadDraft(mountUserId);
      if (cancelled) return;
      if (draft && draft.view.type !== 'lookup' && draft.view.type !== 'done') {
        setResumePrompt({ draft });
        // draftReady stays false — the resume/discard handlers set it once
        // the volunteer has actually made a choice.
      } else {
        draftReady.current = true;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // View-transition persistence + breadcrumbs. Carve-out: 'lookup' never
  // writes (there's nothing to resume into), 'done' only deletes (a
  // write-then-delete in one pass would have unspecified ordering).
  useEffect(() => {
    restoredWizardRef.current = null; // consumed by the render that just committed
    if (view.type !== 'wizard' && view.type !== 'inline-register') {
      wizardPrevStepRef.current = null;
      currentWizardStateRef.current = null;
    }
    if (!draftReady.current || !mountUserId) return;
    if (view.type === 'lookup') return;
    if (view.type === 'done') {
      void deleteDraft(mountUserId);
      return;
    }
    const draft = buildDraft(view);
    if (draft) void saveDraftNow(draft);
    trackEvent('view_change', 'info', { viewType: view.type });
    setTelemetryContext({ viewType: view.type, route: '/enter' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // pagehide: a synchronous best-effort save of whatever is current, in
  // case the tab is being discarded/reloaded before the next state change
  // would otherwise have persisted it.
  useEffect(() => {
    function onPageHide() {
      if (!draftReady.current || !mountUserId) return;
      const v = viewRef.current;
      if (v.type === 'lookup' || v.type === 'done') return;
      const draft = buildDraft(v);
      if (draft) void saveDraftNow(draft);
    }
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleWizardStateChange(step: number, data: Partial<WizardFormData>) {
    currentWizardStateRef.current = { step, data };
    if (!draftReady.current || !mountUserId) return;
    const draft = buildDraft(viewRef.current);
    if (!draft) return;
    if (wizardPrevStepRef.current !== step) {
      wizardPrevStepRef.current = step;
      void saveDraftNow(draft);
      trackEvent('wizard_step', 'info', { wizardStep: step + 1 });
      setTelemetryContext({ wizardStep: step + 1 });
    } else {
      saveDraftDebounced(draft);
    }
  }

  async function handleResumeDraft() {
    if (!resumePrompt) return;
    const { draft } = resumePrompt;
    pendingFamilies.current = draft.pendingFamilies;
    pendingVisitIds.current = draft.pendingVisitIds;
    submissionKeysRef.current = draft.pendingSubmission ?? {};
    if (draft.wizard) {
      restoredWizardRef.current = {
        initialData: (draft.wizard.data as Partial<WizardFormData>) ?? {},
        initialStep: draft.wizard.step,
      };
      currentWizardStateRef.current = draft.wizard as { step: number; data: Partial<WizardFormData> };
      wizardPrevStepRef.current = draft.wizard.step;
    }
    setResumePrompt(null);
    draftReady.current = true;
    setView(draft.view);
    trackEvent('draft_restored', 'info', { viewType: draft.view.type });
  }

  async function handleDiscardDraft() {
    if (mountUserId) await deleteDraft(mountUserId);
    setResumePrompt(null);
    draftReady.current = true;
    trackEvent('draft_discarded', 'info');
  }


  // A family registered online THIS session must be findable if the network
  // dies before the next full directory refresh. Fire-and-forget: a cache
  // write failure only degrades offline lookup, never the check-in.
  function rememberInDirectory(id: string, name: string, phone: string | null | undefined, numPeople: number | null | undefined, proxyPhones: (string | null | undefined)[]) {
    // The proxy designation must reach the offline index too: a family
    // registered WITH a proxy at 9am must be findable by that proxy's phone
    // during a 9:30 outage, or the neighbor gets the register-new dead end.
    const normProxies = proxyPhones.map(p => normalizePhone(p)).filter((p): p is string => p !== null);
    upsertDirectoryFamilies([{
      id, name, name_normalized: normalizeName(name),
      phone: normalizePhone(phone) ?? null, proxy_phones: normProxies,
      num_people: numPeople ?? null, last_visit_date: localDateString(),
    }]).catch(err => {
      console.warn('directory upsert failed — requesting a full re-pull:', err);
      // A full refresh replaces the failed incremental write (and warns
      // through Layout's existing path if storage is truly broken).
      markDirectoryStale();
    });
  }

  async function handleSearch(name: string, phone: string | null) {
    setError(null);
    setOfflineSearch(null);
    try {
      if (phone) {
        const pickup = await api.get<{ own: FamilySearchResult | null; proxy: FamilySearchResult[] }>(
          `/api/families/pickup?phone=${encodeURIComponent(phone)}`
        );
        if (pickup.own || pickup.proxy.length > 0) {
          setView({ type: 'family-select', own: pickup.own, proxy: pickup.proxy, pickupName: pickup.own?.name ?? name, pickupPhone: phone, searchedName: name });
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
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        // Offline is a supported mode, not a dead end. FIRST try the cached
        // family directory: a returning household must resolve to its
        // EXISTING record (offline register-as-new mints a duplicate).
        try {
          // Phone searches keep PICKUP semantics offline: the searcher's own
          // family plus every family that designated this phone, presented
          // together — with the searched phone preserved for the visit.
          if (phone) {
            const pickup = await directoryPickup(phone);
            if (pickup.own || pickup.proxy.length > 0) {
              setView({
                type: 'family-select',
                own: pickup.own ? directoryToSearchResult(pickup.own) : null,
                proxy: pickup.proxy.map(directoryToSearchResult),
                pickupName: pickup.own?.name ?? name,
                pickupPhone: phone,
                searchedName: name,
                notice: 'No connection — from the last synced family list. / Sin conexión — de la última lista sincronizada.',
              });
              return;
            }
          }
          const cached = await searchDirectory(name, phone);
          if (cached.length > 0) {
            setView({
              type: 'results', offline: true, searchName: name, searchPhone: phone,
              results: cached.map(directoryToSearchResult),
            });
            return;
          }
        } catch (err) {
          // A BROKEN cache must visibly BLOCK offline registration: with the
          // roster unreadable, "register as new" for a possibly-returning
          // household is the duplicate-family lane. Do NOT offer it.
          console.warn('offline directory lookup failed — blocking offline registration:', err);
          const detail = err instanceof Error && err.message.includes('blocked by another tab')
            ? ' Close other tabs of this app and retry.'
            : '';
          setError(
            'No connection AND the offline family list is unreadable on this device — do not register families offline. Retry, or find a supervisor.' + detail +
            ' / Sin conexión y la lista sin conexión no se puede leer — no registre familias. Reintente o busque a un supervisor.'
          );
          return;
        }
        setError('Network error. Check connection and try again.');
        setOfflineSearch({ name, phone });
      }
    }
  }

  async function handleSelectResult(result: FamilySearchResult) {
    if (result.phone) {
      try {
        const pickup = await api.get<{ own: FamilySearchResult | null; proxy: FamilySearchResult[] }>(
          `/api/families/pickup?phone=${encodeURIComponent(result.phone)}`
        );
        setView({ type: 'family-select', own: pickup.own ?? result, proxy: pickup.proxy, pickupName: (pickup.own ?? result).name, pickupPhone: result.phone, searchedName: result.name });
        return;
      } catch { /* fall through to single-family select */ }
    }
    setView({ type: 'family-select', own: result, proxy: [], pickupName: result.name, pickupPhone: result.phone, searchedName: result.name });
  }

  async function handleInlineRegisterComplete(data: WizardFormData, proxyData: ProxyData | null) {
    if (view.type !== 'inline-register') return;
    const { returnTo } = view;
    setError(null);
    const today = localDateString();
    const familyPayload = { ...data, first_visit_date: today, proxy: proxyData ?? undefined };
    // Reused across a crash-resume (see handleWizardComplete) rather than
    // minted fresh, and persisted before the POST — a resumed retry then
    // safely no-ops through the server's idempotency handling.
    const familyIdemKey = mintOrReuseKey('familyIdemKey');
    await persistDraftNow(view);
    // One identity for the whole submission: the request's token and the
    // offline attribution must come from the same auth snapshot, or a
    // cross-tab account switch splits them (posted as A, queued as B).
    const auth = getAuth();
    if (!auth || auth.user.id !== mountUserId) {
      // Cross-tab sign-out or account switch racing this handler: fail loud
      // rather than posting under another identity or queueing an item with
      // the wrong (or no) owner.
      setError('The signed-in account changed — nothing was saved. Sign back in as the original account to finish this entry. / La cuenta cambió — no se guardó nada. Vuelva a iniciar sesión con la cuenta original.');
      return;
    }
    const pinned = apiWithToken(auth.token);
    try {
      const result = await pinned.post<{ id: string }>('/api/families', { ...familyPayload, idempotency_key: familyIdemKey });
      rememberInDirectory(result.id, data.name, data.phone, data.num_people, [proxyData?.proxy_phone]);
      clearSubmissionKey('familyIdemKey');
      // Registered online: join this pickup pre-checked. The visit is logged
      // with the rest of the selection through the normal log-visit loop.
      const newFam = {
        id: result.id, name: data.name, phone: data.phone ?? null,
        num_people: data.num_people ?? null, last_visit_date: null,
      } as FamilySearchResult;
      setView({
        type: 'family-select', own: returnTo.own, proxy: returnTo.proxy,
        pickupName: returnTo.pickupName, pickupPhone: returnTo.pickupPhone,
        searchedName: returnTo.searchedName,
        extra: [...returnTo.extra, newFam],
        selectedIds: [...returnTo.selectedIds, result.id],
      });
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message); // stay in the wizard so nothing entered is lost
        return;
      }
      // Offline: queue the family — the flush creates the family AND today's
      // visit, so it must NOT also join this pickup's log-visit loop.
      try {
        await queueItem({ type: 'family', payload: { data: familyPayload, proxyData } }, familyIdemKey, auth.user.id);
        clearSubmissionKey('familyIdemKey'); // offline queue now owns idempotency
      } catch {
        setError('Unable to save offline. Check storage permissions and try again.');
        return;
      }
      setView({
        type: 'family-select', own: returnTo.own, proxy: returnTo.proxy,
        pickupName: returnTo.pickupName, pickupPhone: returnTo.pickupPhone,
        searchedName: returnTo.searchedName,
        extra: returnTo.extra, selectedIds: returnTo.selectedIds,
        notice: `${data.name} was saved offline — their visit for today will upload with sync. Do not select them for this pickup. / Se guardó sin conexión; su visita de hoy se subirá al sincronizar.`,
      });
    }
  }

  function handleFamilySelectConfirm(families: FamilySearchResult[]) {
    if (families.length === 0) return;
    pendingVisitIds.current = [];
    // Carry the SEARCHED phone through to visit creation: when a proxy is
    // picking up, the visit must record who picked up, not lose it.
    const pickupPhone = view.type === 'family-select' ? view.pickupPhone : null;
    setView({ type: 'log-visit', families, current: 0, pickupPhone });
  }

  async function handleLogVisit(familyId: string) {
    if (view.type !== 'log-visit') return;
    const { families, current } = view;
    // Reused across a crash-resume rather than minted fresh (see
    // handleWizardComplete) — a resumed retry of the SAME family-in-loop
    // then safely no-ops through the server's idempotency handling instead
    // of logging a duplicate visit. One slot is sufficient: this loop logs
    // one family's visit at a time, sequentially, never concurrently.
    const visitIdemKey = mintOrReuseKey('visitIdemKey');
    await persistDraftNow(view);
    const family = families.find(f => f.id === familyId);
    // A pickup by someone other than the family's own number is a PROXY
    // pickup — record who actually picked up. NORMALIZE both sides: the
    // typed phone is raw ('480-555-0001') while the stored one is 10 bare
    // digits — raw comparison misattributed a family's own pickup as proxy.
    const normPickup = normalizePhone(view.pickupPhone);
    const pickedUpBy = normPickup && normPickup !== family?.phone ? normPickup : null;
    const visitPayload = {
      family_id: familyId,
      visit_date: localDateString(),
      picked_up_by_phone: pickedUpBy,
      idempotency_key: visitIdemKey,
    };
    let visitId: string | null = null;
    let queueId: string | null = null;
    const auth = getAuth();
    if (!auth || auth.user.id !== mountUserId) {
      // Cross-tab sign-out or account switch racing this handler: fail loud
      // rather than posting under another identity or queueing an item with
      // the wrong (or no) owner.
      setError('The signed-in account changed — nothing was saved. Sign back in as the original account to finish this entry. / La cuenta cambió — no se guardó nada. Vuelva a iniciar sesión con la cuenta original.');
      return;
    }
    const pinned = apiWithToken(auth.token);
    try {
      const result = await pinned.post<{ id: string }>('/api/visits', visitPayload);
      visitId = result.id;
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        return; // server rejected — don't advance, let user see the error
      }
      // Network error — queue with the same idempotency key and continue
      try {
        queueId = await queueItem({ type: 'visit', payload: { family_id: familyId, visit_date: visitPayload.visit_date, picked_up_by_phone: pickedUpBy }, familyName: family?.name }, visitIdemKey, auth.user.id);
      } catch {
        setError('Unable to save offline. Check storage permissions and try again.');
        return;
      }
    }
    // Resolved (succeeded, or now owned by the offline queue's own
    // idempotency) — clear before advancing so the NEXT family in this
    // loop mints its own fresh key.
    clearSubmissionKey('visitIdemKey');
    pendingVisitIds.current.push({ visitId, queueId, visitKey: visitIdemKey });
    if (current + 1 < families.length) {
      setView({ type: 'log-visit', families, current: current + 1, pickupPhone: view.pickupPhone });
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
          visitKey: visitRefs[i]?.visitKey ?? null,
        })),
      });
    }
  }

  // A check-in-time edit (LogVisitScreen's inline "Edit") landed on the
  // server — reflect it in this family's slot so the pickup-attribution
  // check in handleLogVisit and the done-summary use the corrected values,
  // not the stale ones the search first returned.
  function handleFamilyUpdated(id: string, patch: { name: string; phone: string | null; num_people: number | null }) {
    if (view.type !== 'log-visit') return;
    setView({
      ...view,
      families: view.families.map(f => f.id === id ? { ...f, ...patch } : f),
    });
  }

  function handleHowMany(count: number) {
    if (view.type !== 'how-many') return;
    setView({ type: 'proxy-intro', familyCount: count, searchName: view.searchName, searchPhone: view.searchPhone });
  }

  // The proxy question is asked ONCE for the whole batch here, not per
  // family — see proxy-entry below for the "yes" branch.
  function handleProxyIntroAnswer(hasMore: boolean) {
    if (view.type !== 'proxy-intro') return;
    if (hasMore) {
      setView({ type: 'proxy-entry', familyCount: view.familyCount, searchName: view.searchName, searchPhone: view.searchPhone });
      return;
    }
    batchProxiesRef.current = [{ name: view.searchName, phone: view.searchPhone }];
    setView({ type: 'consent', familyCount: view.familyCount, searchName: view.searchName, searchPhone: view.searchPhone });
  }

  function handleProxyEntryContinue(extra: { name: string; phone: string | null }[]) {
    if (view.type !== 'proxy-entry') return;
    batchProxiesRef.current = [{ name: view.searchName, phone: view.searchPhone }, ...extra];
    setView({ type: 'consent', familyCount: view.familyCount, searchName: view.searchName, searchPhone: view.searchPhone });
  }

  function handleConsentContinue() {
    if (view.type !== 'consent') return;
    setView({
      type: 'wizard',
      familyIndex: 0,
      total: view.familyCount,
      initialData: {},
      proxyData: null,
    });
  }

  // Attaches EVERY batch proxy to a newly-created family via the existing,
  // idempotent /api/families/:id/proxies endpoint — reused as-is, no server
  // changes needed. Non-fatal: a failed attachment doesn't block the
  // family/visit the pickup actually depends on; it's surfaced as a warning.
  async function attachBatchProxies(pinned: ReturnType<typeof apiWithToken>, familyId: string): Promise<string | undefined> {
    const failed: string[] = [];
    for (const p of batchProxiesRef.current) {
      try {
        await pinned.post(`/api/families/${familyId}/proxies`, { proxy_name: p.name || null, proxy_phone: p.phone });
      } catch {
        failed.push(p.name || p.phone || 'unknown');
      }
    }
    return failed.length > 0
      ? `Saved, but couldn't record pickup authorization for: ${failed.join(', ')}.`
      : undefined;
  }

  async function handleWizardComplete(data: WizardFormData) {
    if (view.type !== 'wizard') return;
    const { familyIndex, total } = view;
    setError(null);

    const today = localDateString();
    const familyPayload = {
      ...data,
      first_visit_date: today,
    };
    // Who's picking up TODAY — the first person entered (at lookup); any
    // others are authorization for future visits, not today's attribution.
    // Normalize both sides: a raw typed phone never equals the family's
    // already-normalized stored one, which would misattribute a family's
    // own pickup as a proxy pickup.
    const normPickupPhone = normalizePhone(batchProxiesRef.current[0]?.phone ?? null);
    const pickedUpBy = normPickupPhone && normPickupPhone !== normalizePhone(data.phone) ? normPickupPhone : null;
    // Mint (or reuse, if resumed from a draft) both keys before the first
    // attempt so the server can de-dup even if the network drops after it
    // committed but before the reply arrived — AND so a tab crash/reload
    // right here doesn't produce a genuine duplicate on retry: persisting
    // them now (synchronously, before any POST) means a resumed retry
    // reuses the SAME keys through the server's existing idempotency
    // handling instead of minting fresh ones. Both keys are cleared
    // together right before advanceWizard() below, once this family's
    // submission is fully resolved one way or another.
    const familyIdemKey = mintOrReuseKey('familyIdemKey');
    const visitIdemKey = mintOrReuseKey('visitIdemKey');
    await persistDraftNow(view);

    // This submission spans TWO requests (family, then visit) plus offline
    // attribution — pin all of it to one auth snapshot.
    const auth = getAuth();
    if (!auth || auth.user.id !== mountUserId) {
      // Cross-tab sign-out or account switch racing this handler: fail loud
      // rather than posting under another identity or queueing an item with
      // the wrong (or no) owner.
      setError('The signed-in account changed — nothing was saved. Sign back in as the original account to finish this entry. / La cuenta cambió — no se guardó nada. Vuelva a iniciar sesión con la cuenta original.');
      return;
    }
    const pinned = apiWithToken(auth.token);

    // --- POST family ---
    let familyId: string;
    try {
      const result = await pinned.post<{ id: string }>('/api/families', {
        ...familyPayload,
        idempotency_key: familyIdemKey,
      });
      familyId = result.id;
      rememberInDirectory(familyId, data.name, data.phone, data.num_people, batchProxiesRef.current.map(p => p.phone));
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        return; // server rejected — don't advance
      }
      // Network error — queue family + visit pair together and advance. The
      // flush attaches every batch proxy once the family itself has synced.
      let familyQueueId: string;
      try {
        familyQueueId = await queueItem({
          type: 'family',
          payload: { data: familyPayload, proxies: batchProxiesRef.current.map(p => ({ proxy_name: p.name || null, proxy_phone: p.phone })) },
        }, familyIdemKey, auth.user.id);
      } catch {
        setError('Unable to save offline. Check storage permissions and try again.');
        return;
      }
      pendingFamilies.current.push({ id: '', name: data.name, num_people: data.num_people ?? null, bag_received: null, visitId: null, queueId: familyQueueId, visitKey: `${familyIdemKey}-visit` });
      // The offline queue now owns idempotency for this submission via its
      // own persisted key — clear ours so the NEXT family in this loop
      // mints fresh ones rather than reusing this family's.
      clearSubmissionKey('familyIdemKey');
      clearSubmissionKey('visitIdemKey');
      advanceWizard(familyIndex, total);
      return;
    }

    // Family is live — attach every batch proxy to it (idempotent; a
    // failure here is a warning, not a block on the visit below).
    const proxyError = await attachBatchProxies(pinned, familyId);

    // --- POST visit (family already committed to DB with real id) ---
    const visitPayload = {
      family_id: familyId,
      visit_date: today,
      picked_up_by_phone: pickedUpBy,
    };
    let visitId: string | null = null;
    let visitQueueId: string | null = null;
    let visitError: string | undefined = proxyError;
    try {
      const visitResult = await pinned.post<{ id: string }>('/api/visits', { ...visitPayload, idempotency_key: visitIdemKey });
      visitId = visitResult.id;
    } catch (e) {
      if (e instanceof ApiError) {
        // Family saved — still advance but surface the error
        visitError = [visitError, `Family saved, but visit log failed: ${e.message}`].filter(Boolean).join(' ');
      } else {
        // Network — queue only the visit (family already has an id)
        try {
          visitQueueId = await queueItem({ type: 'visit', payload: visitPayload, familyName: data.name }, visitIdemKey, auth.user.id);
        } catch {
          visitError = [visitError, 'Visit not saved offline. Check storage permissions.'].filter(Boolean).join(' ');
        }
      }
    }

    pendingFamilies.current.push({ id: familyId, name: data.name, num_people: data.num_people ?? null, bag_received: null, visitId, queueId: visitQueueId, visitKey: visitIdemKey });
    // Fully resolved (visit succeeded, errored terminally, or is now owned
    // by the offline queue's own idempotency) — clear before advancing so
    // the next family in a multi-family loop mints fresh keys.
    clearSubmissionKey('familyIdemKey');
    clearSubmissionKey('visitIdemKey');
    advanceWizard(familyIndex, total, visitError);
  }

  function advanceWizard(familyIndex: number, total: number, pendingError?: string) {
    if (familyIndex + 1 < total) {
      // Surface any visit error before moving to next wizard entry
      if (pendingError) setError(pendingError);
      // Straight to the next family's wizard — the proxy was already
      // decided once for the whole batch, not re-asked per family.
      setView({
        type: 'wizard',
        familyIndex: familyIndex + 1,
        total,
        initialData: {},
        proxyData: null,
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

  // Resume prompt is exclusive, not an overlay: rendering it alongside the
  // (still fully interactive) lookup screen let a volunteer act on stale
  // UI while undecided, and clicking Resume afterward would unconditionally
  // clobber whatever they'd just done — review finding, PR #14. Render
  // ONLY the prompt until Resume/Discard resolves it.
  if (resumePrompt) {
    const name = draftDisplayName(resumePrompt.draft.view) || 'this family / esta familia';
    const isWizard = resumePrompt.draft.view.type === 'wizard' || resumePrompt.draft.view.type === 'inline-register';
    const step = (resumePrompt.draft.wizard?.step ?? 0) + 1;
    return (
      <div className="enter-page">
        <p className="banner" role="alertdialog" aria-label="Resume entry">
          {isWizard
            ? <>Resume the entry for {name}? (step {step} of 11) / ¿Continuar el registro de {name}? (paso {step} de 11)</>
            : <>Resume the unfinished check-in for {name}? / ¿Continuar el registro sin terminar de {name}?</>}
          <br />
          <button className="btn-primary" onClick={handleResumeDraft} style={{ marginTop: 8, marginRight: 8 }}>
            Resume / Continuar
          </button>
          <button className="btn-ghost" onClick={handleDiscardDraft} style={{ marginTop: 8 }}>
            Discard / Descartar
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="enter-page">
      {error && <p className="error banner">{error}</p>}
      {offlineSearch && view.type === 'lookup' && (
        <p className="banner">
          <button
            className="btn-primary"
            onClick={() => {
              setError(null);
              const target = offlineSearch;
              setOfflineSearch(null);
              setView({ type: 'how-many', searchName: target.name, searchPhone: target.phone });
            }}
          >
            No connection — continue and register as new / Sin conexión — continuar y registrar como nuevo
          </button>
        </p>
      )}

      {view.type === 'lookup' && (
        <LookupForm onSearch={handleSearch} />
      )}
      {view.type === 'results' && (
        <>
        {view.offline && (
          <p className="banner">
            No connection — results from the last synced family list. / Sin conexión — resultados de la última lista sincronizada.
          </p>
        )}
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
        </>
      )}
      {view.type === 'family-select' && (
        <FamilySelectScreen
          own={view.own}
          proxy={view.proxy}
          pickupName={view.pickupName}
          pickupPhone={view.pickupPhone}
          searchedName={view.searchedName}
          initialExtra={view.extra}
          initialSelected={view.selectedIds}
          notice={view.notice}
          onConfirm={handleFamilySelectConfirm}
          onRegisterNew={(query, keep) => {
            if (view.type !== 'family-select') return;
            setView({
              type: 'inline-register', prefillName: query,
              returnTo: {
                own: view.own, proxy: view.proxy,
                pickupName: view.pickupName, pickupPhone: view.pickupPhone,
                searchedName: view.searchedName,
                extra: keep.extra, selectedIds: keep.selectedIds,
              },
            });
          }}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'inline-register' && (
        <Wizard
          familyIndex={0}
          total={1}
          initialData={restoredWizardRef.current?.initialData ?? { name: view.prefillName }}
          initialStep={restoredWizardRef.current?.initialStep}
          onStateChange={handleWizardStateChange}
          proxyData={view.returnTo.pickupPhone
            ? { proxy_name: view.returnTo.pickupName.trim() || null, proxy_phone: view.returnTo.pickupPhone }
            : null}
          onComplete={handleInlineRegisterComplete}
          onBack={() => {
            if (view.type !== 'inline-register') return;
            // Abandoning this attempt — a key minted by a prior failed
            // submission for THIS slot must not leak into whatever gets
            // entered next (review finding, PR #14 cycle 2).
            submissionKeysRef.current = {};
            const { returnTo } = view;
            setView({
              type: 'family-select', own: returnTo.own, proxy: returnTo.proxy,
              pickupName: returnTo.pickupName, pickupPhone: returnTo.pickupPhone,
              searchedName: returnTo.searchedName,
              extra: returnTo.extra, selectedIds: returnTo.selectedIds,
            });
          }}
        />
      )}
      {view.type === 'log-visit' && (
        <LogVisitScreen
          family={view.families[view.current]}
          total={view.families.length}
          current={view.current}
          onLogVisit={handleLogVisit}
          onFamilyUpdated={handleFamilyUpdated}
        />
      )}
      {view.type === 'how-many' && (
        <HowManyFamilies
          onSelect={handleHowMany}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'proxy-intro' && (
        <ProxyIntroScreen
          searchName={view.searchName}
          searchPhone={view.searchPhone}
          onAnswer={handleProxyIntroAnswer}
          onBack={() => setView({ type: 'how-many', searchName: view.searchName, searchPhone: view.searchPhone })}
        />
      )}
      {view.type === 'proxy-entry' && (
        <ProxyEntryForm
          onContinue={handleProxyEntryContinue}
          onBack={() => setView({ type: 'proxy-intro', familyCount: view.familyCount, searchName: view.searchName, searchPhone: view.searchPhone })}
        />
      )}
      {view.type === 'consent' && (
        <ConsentScreen
          onContinue={handleConsentContinue}
          onBack={() => {
            if (view.type === 'consent') {
              setView({ type: 'how-many', searchName: view.searchName, searchPhone: view.searchPhone });
            }
          }}
        />
      )}
      {view.type === 'wizard' && (
        <Wizard
          familyIndex={view.familyIndex}
          total={view.total}
          initialData={restoredWizardRef.current?.initialData ?? view.initialData}
          initialStep={restoredWizardRef.current?.initialStep}
          onStateChange={handleWizardStateChange}
          proxyData={view.proxyData}
          onComplete={handleWizardComplete}
          onBack={() => {
            if (view.type === 'wizard') {
              // Abandoning this attempt — a key minted by a prior failed
              // submission for THIS family slot must not leak into
              // whatever gets entered next (review finding, PR #14
              // cycle 2): the volunteer could go Back, change the name
              // or answers, and re-submit — reusing the old key would
              // make the server replay the ABANDONED data via
              // idempotency, silently discarding the new entry. There's
              // no per-family screen to step back to anymore (the proxy
              // is decided once for the whole batch) — back restarts the
              // batch from the top, same as it ultimately did before.
              submissionKeysRef.current = {};
              setView({
                type: 'how-many',
                searchName: batchProxiesRef.current[0]?.name ?? '',
                searchPhone: batchProxiesRef.current[0]?.phone ?? null,
              });
            }
          }}
        />
      )}
    </div>
  );
}
