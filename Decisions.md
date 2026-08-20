# Decisions

Architectural and design trade-offs for this repo, recorded when a choice is made between genuinely valid alternatives. See `preserving-productive-tensions` methodology — this file captures the ones we resolved, and why.

## Draft-write failures never block a submission (issue #12 / PR #14, cycle-2 finding #14)

**Context:** `src/pwa/lib/draft.ts`'s `saveDraftNow` persists the in-progress entry (including the idempotency key used for the family/visit POST) to IndexedDB before submitting. The write is wrapped in try/catch and never throws — a failure is logged (`console.warn`) but the caller proceeds to submit regardless.

`/dual-review` (Codex) flagged that this is a narrow gap: if IndexedDB is broken/full on a device *and* the tab crashes at the exact instant between the server committing and the client processing the response, resuming mints a fresh idempotency key (the failed draft write never persisted the one already in use) and can create a genuine duplicate family/visit record.

**Option A — Tolerate the edge case (chosen).** Keep `saveDraftNow` best-effort and non-blocking. Optimizes for: availability — a check-in always completes if the network is up, regardless of storage health. Best when: the device fleet is old/unreliable hardware in the field (this app's actual deployment — volunteer tablets/phones at a food distribution event), where "storage is flaky today" is a realistic, not hypothetical, condition.

**Option B — Block the POST until the draft write is confirmed.** Optimizes for: data integrity — eliminates the duplicate-record window entirely. Best when: the write target is a system where a duplicate record is costlier than a blocked submission (e.g., financial transactions), or storage reliability isn't in question.

**Why A:** the two failure modes aren't symmetric. Option B's failure mode — a volunteer on a device with degraded storage cannot check in *anyone*, for the rest of the event — is common and severe (this app has no offline-storage-free fallback for the initial submission attempt). Option A's failure mode requires two independent rare conditions to coincide (storage already broken, and a crash timed to the few-hundred-millisecond window around a specific POST) and produces a duplicate row, which is a nuisance for records/reporting, not a food-line-blocking outage. Trading a common severe failure for a rare recoverable one is the wrong trade for a tool whose stated purpose (see `CLAUDE.md`, `README.md`) is staying usable on bad hardware. Keeping `saveDraftNow` simple and consistent with the rest of this file's established best-effort philosophy (KISS) also avoids adding a second failure-handling path (write-confirmed vs. write-failed submission flows) to a component that already carries meaningful state-machine complexity from the same PR (`submissionKeysRef`, resume-prompt gating, multi-family loop).

**Preservation strategy:** Documented trade-off. Not configurable — a per-deployment toggle here would be speculative complexity for a condition that hasn't been observed in practice.

**Resolution trigger:** if a duplicate family/visit record traceable to this gap is ever observed in production (`client_events`/`record_changes` audit trail, or admin-reported), revisit — likely fix: surface a distinct, recoverable warning in the resume prompt when a restored draft's `pendingSubmission` key could not be confirmed as durably written (rather than blocking submission outright), so the volunteer is told to double-check rather than the system silently risking a duplicate.

**Origin:** `/dual-review` PR #14, cycle 2, finding #14. Full review context: PR comments on [creightoncommunity/foodbox-data-app#14](https://github.com/creightoncommunity/foodbox-data-app/pull/14).
