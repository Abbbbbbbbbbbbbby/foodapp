# Graph Report - /Users/jboles/vibe-projects/foodbox-data-app  (2026-08-12)

## Corpus Check
- 68 files · ~110,000 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 441 nodes · 548 edges · 30 communities detected
- Extraction: 86% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 72 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]

## God Nodes (most connected - your core abstractions)
1. `Food Line Check-In App (mobile-first PWA)` - 13 edges
2. `fetch()` - 12 edges
3. `openDb()` - 11 edges
4. `normalizePhone()` - 11 edges
5. `transformRow()` - 10 edges
6. `handleRecordRoutes()` - 10 edges
7. `flushQueue()` - 9 edges
8. `D1 Data Model (mirrors Bubble.io)` - 8 edges
9. `normalizeName()` - 8 edges
10. `handleFamilyRoutes()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `foodbox-data-app (Astro app on Cloudflare Workers)` --semantically_similar_to--> `React + Vite PWA Scaffold (src/pwa/)`  [AMBIGUOUS] [semantically similar]
  README.md → docs/superpowers/plans/2026-06-12-food-line-app-plan3-pwa.md
- `Abby Repo Onboarding Guide` --conceptually_related_to--> `Plan 3: React PWA Check-In Flow`  [AMBIGUOUS]
  ABBY-START-HERE.md → docs/superpowers/plans/2026-06-12-food-line-app-plan3-pwa.md
- `createOtp()` --references--> `otp_codes table`  [EXTRACTED]
  /Users/jboles/vibe-projects/foodbox-data-app/src/worker/otp.ts → migrations/0001_initial.sql
- `verifyOtp()` --references--> `otp_codes table`  [EXTRACTED]
  /Users/jboles/vibe-projects/foodbox-data-app/src/worker/otp.ts → migrations/0001_initial.sql
- `handleQuestionRoutes()` --references--> `question_settings table (bilingual intake form config + seed rows)`  [EXTRACTED]
  /Users/jboles/vibe-projects/foodbox-data-app/src/worker/routes/questions.ts → migrations/0002_question_settings.sql

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (50): Accessibility & Usability Requirements (48px targets, high contrast), Client-Side AMI Bracket Calculation (step 8), AMI Thresholds (Maricopa County, by family size), Architecture Key Properties (no data loss offline, SQL migration, zero-cost scaling), Bilingual Design Rules (EN/ES equal prominence), Bubble.io Replacement Context (usability, bilingual, connectivity pain), Cloudflare Pages + Workers + D1 + KV Architecture, Core Check-In Flow (/enter, unified lookup routing) (+42 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (42): AbortController, Blob, ByteLengthQueuingStrategy, CloseEvent, CompileError, CompressionStream, CountQueuingStrategy, CustomEvent (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (18): ApiError, apiFetch(), getVisitsByFamily(), insertVisit(), handleDismiss(), handleDuplicateRoutes(), handleMerge(), mergeFamilies() (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (10): localDateString(), localMonthStart(), advanceWizard(), handleInlineRegisterComplete(), handleLogVisit(), handleWizardComplete(), generateUUID(), queueItem() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.16
Nodes (24): handleAdminRoutes(), handleDeleteUser(), handleImport(), handleListUsers(), handleUpdateUser(), escapeLike(), getFamiliesForPickup(), getFamilyById() (+16 more)

### Community 5 - "Community 5"
Cohesion: 0.16
Nodes (20): apiFn(), doFlush(), handleAcknowledgeDeadLetters(), handleLogout(), refresh(), addDeadLetter(), BagPatchError, clearDeadLetters() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.18
Nodes (14): calcAmiBracket(), getAmi(), handleDrop(), handleFile(), handleFileInput(), parseBool(), parseBubbleDate(), parseBubbleDateList() (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.24
Nodes (13): subscribeRecipient(), toBubbleLang(), allowedFamilyFields(), allowedVisitFields(), handleAddVisit(), handleDeleteFamily(), handleDeleteVisit(), handleGetChanges() (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.3
Nodes (12): handleAuthRoutes(), handleLogin(), handleLogout(), handleMe(), handleRegister(), handleVerify(), checkOtpSendLimit(), checkVerifyLimit() (+4 more)

### Community 9 - "Community 9"
Cohesion: 0.24
Nodes (9): buildSession(), fromBase64url(), getSession(), importKey(), signJwt(), toBase64url(), verifyJwt(), getAuthContext() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (13): Offline Strategy (app shell cache + IndexedDB submission queue), IndexedDB Offline Queue (src/pwa/lib/offline.ts), React + Vite PWA Scaffold (src/pwa/), Service Worker App Shell Cache (src/pwa/public/sw.js), Deploy Config Preservation Rule (the one rule), Merge Skeleton Workflow (Claude Code paste-in prompt), Abby Repo Onboarding Guide, Astro Dev Server Background Mode (astro dev --background) (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.23
Nodes (6): auditPhone(), generateMigration(), normalizeName(), normalizePhone(), sq(), uid()

### Community 12 - "Community 12"
Cohesion: 0.24
Nodes (7): getAuth(), getToken(), getUser(), setAuth(), LoginPage(), RegisterPage, VerifyPage()

### Community 13 - "Community 13"
Cohesion: 0.28
Nodes (4): confirmMerge(), dismiss(), onDismissed(), onMerged()

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (2): formatDate(), lastActivity()

### Community 15 - "Community 15"
Cohesion: 0.47
Nodes (4): otp_codes table, createOtp(), generateOtpCode(), verifyOtp()

### Community 17 - "Community 17"
Cohesion: 0.4
Nodes (1): ApiError

### Community 19 - "Community 19"
Cohesion: 0.67
Nodes (4): families table, proxies table (pickup authorizations), users table, visits table

### Community 20 - "Community 20"
Cohesion: 0.5
Nodes (1): FakeApiError

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (1): ApiError

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (2): question_settings table (bilingual intake form config + seed rows), handleQuestionRoutes()

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (2): clearRl(), kv()

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (2): LookupForm (Name/Phone Search Form), ResultsList (Family Search Results)

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (2): Astro Framework, Site Favicon (Default Astro Logo)

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (1): income_buckets reference table (AMI brackets)

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (1): PhoneInput (Phone Step with Skip)

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (1): PWA Bootstrap (main.tsx)

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (1): AuthUser (authenticated user shape with role)

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (1): Vitest PWA Config (node env)

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (1): Vitest Scripts Config (node env)

## Ambiguous Edges - Review These
- `foodbox-data-app (Astro app on Cloudflare Workers)` → `React + Vite PWA Scaffold (src/pwa/)`  [AMBIGUOUS]
  README.md · relation: semantically_similar_to
- `Abby Repo Onboarding Guide` → `Plan 3: React PWA Check-In Flow`  [AMBIGUOUS]
  ABBY-START-HERE.md · relation: conceptually_related_to

## Knowledge Gaps
- **64 isolated node(s):** `DOMException`, `CompileError`, `RuntimeError`, `Global`, `Instance` (+59 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 14`** (7 nodes): `changeRole()`, `deleteUser()`, `formatDate()`, `lastActivity()`, `rolePillStyle()`, `toggleActive()`, `AdminAccountsPage.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (5 nodes): `ApiError`, `.constructor()`, `renderScreen()`, `result()`, `FamilySelectScreen.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (4 nodes): `FakeApiError`, `.constructor()`, `freshDb()`, `offline-flush.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (4 nodes): `ApiError`, `.constructor()`, `searchFor()`, `EnterPage.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (3 nodes): `question_settings table (bilingual intake form config + seed rows)`, `handleQuestionRoutes()`, `questions.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (3 nodes): `clearRl()`, `kv()`, `ratelimit.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `LookupForm (Name/Phone Search Form)`, `ResultsList (Family Search Results)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `Astro Framework`, `Site Favicon (Default Astro Logo)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `income_buckets reference table (AMI brackets)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `PhoneInput (Phone Step with Skip)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `PWA Bootstrap (main.tsx)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `AuthUser (authenticated user shape with role)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `Vitest PWA Config (node env)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `Vitest Scripts Config (node env)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `foodbox-data-app (Astro app on Cloudflare Workers)` and `React + Vite PWA Scaffold (src/pwa/)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Abby Repo Onboarding Guide` and `Plan 3: React PWA Check-In Flow`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `fetch()` connect `Community 2` to `Community 8`, `Community 4`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `handleLogout()` connect `Community 5` to `Community 2`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `set()` connect `Community 2` to `Community 11`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `fetch()` (e.g. with `createFamily()` and `handleLogout()`) actually correct?**
  _`fetch()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `normalizePhone()` (e.g. with `handleImport()` and `handleAddProxy()`) actually correct?**
  _`normalizePhone()` has 7 INFERRED edges - model-reasoned connections that need verification._