# Plan 3 — PWA Check-In Flow — Progress Ledger
Branch start: 2a97e06

## Tasks
- [ ] Task 1: Worker API routes (families, visits, questions)
- [ ] Task 2: React + Vite scaffold
- [ ] Task 3: Auth store + auth pages
- [ ] Task 4: Layout + Home screen
- [ ] Task 5: Client utilities (ami, api, offline)
- [ ] Task 6: LookupForm component
- [ ] Task 7: Returning family path (ResultsList, FamilySelectScreen, LogVisitScreen)
- [ ] Task 8: New family flow (HowManyFamilies, ProxyQuestion)
- [ ] Task 9: Registration Wizard
- [ ] Task 10: EnterPage orchestrator + Service Worker

## Completed
- [x] Task 1: complete (commits 2a97e06..e69eb31, review clean)
  Minor: no test for proxy insertion branch; PATCH returns 200 on non-existent ID
- [x] Task 2: complete (commits e69eb31..0a04830, review clean)
- [x] Task 3: complete (commits 0a04830..88bd2f5, review clean)
- [x] Task 4: complete (commits 88bd2f5..b08d702, review clean)
- [x] Task 5: complete (commits b08d702..a59c3ca, review clean)
- [x] Task 6: complete (commits a59c3ca..502fbf7, review clean)
- [x] Task 7: complete (commits 502fbf7..8f508e2, review clean)
- [x] Task 8: complete (commits 8f508e2..4aaede9, review clean)
- [x] Task 9: complete (commits 4aaede9..82b36ab, fix: TextsStep stale-state bug caught during controller review — finish() now receives typed final values rather than reading batched-but-unapplied state)
- [x] Task 10: complete (commits 82b36ab..a6ec091, review clean)

## Final whole-branch review (9645250..675fb14)
Fixed before merge: SQL injection in updateFamily (column allowlist), btn-ghost touch-target violation, empty-PATCH SQL error, malformed-JSON 400.
Deferred (design decisions): offline queue replay path (plan only specifies queueing, not flush), OTP brute-force protection, self-registration approval gate, non-atomic family+proxy insert, CORS origin pinning.
Branch: APPROVED after fixes.
