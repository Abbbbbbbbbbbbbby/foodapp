# Graph Report - /Users/jboles/vibe-projects/foodbox-data-app  (2026-07-22)

## Corpus Check
- 64 files · ~100,196 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 312 nodes · 462 edges · 12 communities detected
- Extraction: 84% EXTRACTED · 15% INFERRED · 1% AMBIGUOUS · INFERRED: 69 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Design Spec & Product Requirements|Design Spec & Product Requirements]]
- [[_COMMUNITY_Workers Runtime Type Globals|Workers Runtime Type Globals]]
- [[_COMMUNITY_PWA API Client & Check-In Orchestration|PWA API Client & Check-In Orchestration]]
- [[_COMMUNITY_JWT & Session Auth Core|JWT & Session Auth Core]]
- [[_COMMUNITY_Family & Visit Data Access|Family & Visit Data Access]]
- [[_COMMUNITY_AMI Brackets & Question Config|AMI Brackets & Question Config]]
- [[_COMMUNITY_PWA Routing & Auth Store|PWA Routing & Auth Store]]
- [[_COMMUNITY_Auth API Routes & User Tables|Auth API Routes & User Tables]]
- [[_COMMUNITY_Wizard Input Components|Wizard Input Components]]
- [[_COMMUNITY_Offline Strategy & Repo Onboarding|Offline Strategy & Repo Onboarding]]
- [[_COMMUNITY_User Role Types|User Role Types]]
- [[_COMMUNITY_Astro Skeleton Remnants|Astro Skeleton Remnants]]

## God Nodes (most connected - your core abstractions)
1. `getAuthContext()` - 14 edges
2. `fetch()` - 13 edges
3. `Food Line Check-In App (mobile-first PWA)` - 13 edges
4. `families table` - 11 edges
5. `createSession()` - 10 edges
6. `buildSession()` - 10 edges
7. `Wizard (11-Step Registration Wizard)` - 9 edges
8. `queueItem()` - 8 edges
9. `normalizePhone()` - 8 edges
10. `getFamiliesForPickup()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `income_buckets reference table (AMI brackets)` --conceptually_related_to--> `Family interface`  [AMBIGUOUS]
  migrations/0001_initial.sql → src/worker/schema.ts
- `foodbox-data-app (Astro app on Cloudflare Workers)` --semantically_similar_to--> `React + Vite PWA Scaffold (src/pwa/)`  [AMBIGUOUS] [semantically similar]
  README.md → docs/superpowers/plans/2026-06-12-food-line-app-plan3-pwa.md
- `calculateAmiBracket()` --shares_data_with--> `income_buckets reference table (AMI brackets)`  [INFERRED]
  /Users/jboles/vibe-projects/foodbox-data-app/scripts/migrate-bubble.js → migrations/0001_initial.sql
- `User interface` --implements--> `users table`  [INFERRED]
  src/worker/schema.ts → migrations/0001_initial.sql
- `Family interface` --implements--> `families table`  [INFERRED]
  src/worker/schema.ts → migrations/0001_initial.sql

## Hyperedges (group relationships)
- **OTP SMS Authentication Flow** — auth_handlelogin, auth_handleregister, auth_handleverify, otp_generateotpcode, otp_createotp, otp_verifyotp, otp_sendotpsms, auth_buildsession, auth_createsession, 0001_initial_otp_codes [EXTRACTED 0.90]
- **JWT + KV Session Lifecycle** — auth_buildsession, auth_signjwt, auth_verifyjwt, auth_createsession, auth_getsession, auth_destroysession, middleware_getauthcontext, auth_handlelogout [INFERRED 0.85]
- **Food Box Pickup Flow (own + proxy lookup, then visit log)** — families_handlepickup, db_getfamiliesforpickup, 0001_initial_proxies, visits_handlecreate, db_insertvisit, 0001_initial_visits [INFERRED 0.80]
- **Wizard Step Input Contract (bilingual questionEn/questionEs + onBack props)** — textinput_textinput, phoneinput_phoneinput, numberinput_numberinput, selectinput_selectinput, incomeinput_incomeinput [INFERRED 0.90]
- **Food Distribution Check-in Flow (lookup → results → proxy → count → select → log/wizard → summary)** — lookupform_lookupform, resultslist_resultslist, proxyquestion_proxyquestion, howmanyfamilies_howmanyfamilies, familyselectscreen_familyselectscreen, logvisitscreen_logvisitscreen, wizard_wizard, summaryscreen_summaryscreen [INFERRED 0.80]
- **Auth-Gated App Shell (token guard + layout + auth store)** — app_app, app_protectedlayout, layout_layout, auth_gettoken [EXTRACTED 0.95]
- **Offline Write Queue Flow (fail API call, queue to IndexedDB, later replay/remove)** — enterpage_enterpage, api_api, offline_queueitem, offline_getpending, offline_removeitem [INFERRED 0.85]
- **Phone OTP Auth Token Flow (login/register, verify, store token, bearer on API calls)** — loginpage_loginpage, registerpage_registerpage, verifypage_verifypage, auth_setauth, auth_gettoken, api_apifetch [INFERRED 0.90]
- **Safari 9 / iPad 3 Compatibility Pattern (legacy bundle, uuid fallback, manual querystring)** — vite_config_legacy, offline_uuid, enterpage_enterpage [INFERRED 0.80]
- **Food Line App Phased Implementation (spec + Plans 1-3)** — 2026_05_20_food_line_app_design_food_line_checkin_app, 2026_05_20_food_line_app_plan1_foundation_plan1_foundation, 2026_06_10_food_line_app_plan2_auth_plan2_auth, 2026_06_12_food_line_app_plan3_pwa_plan3_pwa [EXTRACTED 1.00]
- **Offline-First Submission Flow** — 2026_05_20_food_line_app_design_offline_strategy, 2026_06_12_food_line_app_plan3_pwa_offline_queue, 2026_06_12_food_line_app_plan3_pwa_service_worker, 2026_06_12_food_line_app_plan3_pwa_enterpage_state_machine [EXTRACTED 1.00]
- **SMS OTP Authentication Flow** — 2026_05_20_food_line_app_design_sms_otp_authentication, 2026_06_10_food_line_app_plan2_auth_otp_utilities, 2026_06_10_food_line_app_plan2_auth_jwt_session_utilities, 2026_06_10_food_line_app_plan2_auth_auth_middleware, 2026_06_10_food_line_app_plan2_auth_auth_api_routes [EXTRACTED 1.00]

## Communities

### Community 0 - "Design Spec & Product Requirements"
Cohesion: 0.06
Nodes (50): Accessibility & Usability Requirements (48px targets, high contrast), Client-Side AMI Bracket Calculation (step 8), AMI Thresholds (Maricopa County, by family size), Architecture Key Properties (no data loss offline, SQL migration, zero-cost scaling), Bilingual Design Rules (EN/ES equal prominence), Bubble.io Replacement Context (usability, bilingual, connectivity pain), Cloudflare Pages + Workers + D1 + KV Architecture, Core Check-In Flow (/enter, unified lookup routing) (+42 more)

### Community 1 - "Workers Runtime Type Globals"
Cohesion: 0.05
Nodes (42): AbortController, Blob, ByteLengthQueuingStrategy, CloseEvent, CompileError, CompressionStream, CountQueuingStrategy, CustomEvent (+34 more)

### Community 2 - "PWA API Client & Check-In Orchestration"
Cohesion: 0.08
Nodes (24): api (API Client), ApiError, apiFetch(), EnterPage (Check-in Flow Orchestrator), handleLogVisit(), handleWizardComplete(), FamilySelectScreen (Multi-Family Selection), App Shell HTML (index.html) (+16 more)

### Community 3 - "JWT & Session Auth Core"
Cohesion: 0.1
Nodes (22): buildSession(), createSession(), destroySession(), fromBase64url(), getSession(), importKey(), signJwt(), Auth endpoint integration tests (SELF.fetch) (+14 more)

### Community 4 - "Family & Visit Data Access"
Cohesion: 0.15
Nodes (28): families table, proxies table (pickup authorizations), visits table, getFamiliesForPickup(), getFamilyById(), getVisitsByFamily(), insertFamily(), insertVisit() (+20 more)

### Community 5 - "AMI Brackets & Question Config"
Cohesion: 0.13
Nodes (17): income_buckets reference table (AMI brackets), question_settings table (bilingual intake form config + seed rows), calcAmiBracket(), getAmi(), AMI unit tests, annualizeIncome(), calculateAmiBracket(), mapHispanic() (+9 more)

### Community 6 - "PWA Routing & Auth Store"
Cohesion: 0.18
Nodes (13): App (PWA Router Root), ProtectedLayout(), clearAuth(), getAuth(), getToken(), getUser(), setAuth(), HomePage (+5 more)

### Community 7 - "Auth API Routes & User Tables"
Cohesion: 0.27
Nodes (14): otp_codes table, users table, handleAuthRoutes(), handleLogin(), handleLogout(), handleMe(), handleRegister(), handleVerify() (+6 more)

### Community 8 - "Wizard Input Components"
Cohesion: 0.17
Nodes (12): HowManyFamilies (Pickup Count Question), IncomeInput (Income to AMI Bracket Input), NumberInput(), PhoneInput (Phone Step with Skip), ProxyQuestion (Designated Pickup Person), SelectInput(), TextInput(), Family (canonical family record) (+4 more)

### Community 9 - "Offline Strategy & Repo Onboarding"
Cohesion: 0.19
Nodes (13): Offline Strategy (app shell cache + IndexedDB submission queue), IndexedDB Offline Queue (src/pwa/lib/offline.ts), React + Vite PWA Scaffold (src/pwa/), Service Worker App Shell Cache (src/pwa/public/sw.js), Deploy Config Preservation Rule (the one rule), Merge Skeleton Workflow (Claude Code paste-in prompt), Abby Repo Onboarding Guide, Astro Dev Server Background Mode (astro dev --background) (+5 more)

### Community 14 - "User Role Types"
Cohesion: 1.0
Nodes (2): AuthUser (authenticated user shape with role), UserRole (admin|staff|volunteer)

### Community 15 - "Astro Skeleton Remnants"
Cohesion: 1.0
Nodes (2): Astro Framework, Site Favicon (Default Astro Logo)

## Ambiguous Edges - Review These
- `getPending()` → `api (API Client)`  [AMBIGUOUS]
  src/pwa/lib/offline.ts · relation: conceptually_related_to
- `setAuth()` → `Vitest Workers Config (worker tests, miniflare bindings)`  [AMBIGUOUS]
  vitest.config.ts · relation: conceptually_related_to
- `Family interface` → `income_buckets reference table (AMI brackets)`  [AMBIGUOUS]
  migrations/0001_initial.sql · relation: conceptually_related_to
- `LookupForm (Name/Phone Search Form)` → `EnterPage (Check-in Flow Orchestrator)`  [AMBIGUOUS]
  src/pwa/components/enter/LookupForm.tsx · relation: references
- `foodbox-data-app (Astro app on Cloudflare Workers)` → `React + Vite PWA Scaffold (src/pwa/)`  [AMBIGUOUS]
  README.md · relation: semantically_similar_to
- `Abby Repo Onboarding Guide` → `Plan 3: React PWA Check-In Flow`  [AMBIGUOUS]
  ABBY-START-HERE.md · relation: conceptually_related_to

## Knowledge Gaps
- **65 isolated node(s):** `DOMException`, `CompileError`, `RuntimeError`, `Global`, `Instance` (+60 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `User Role Types`** (2 nodes): `AuthUser (authenticated user shape with role)`, `UserRole (admin|staff|volunteer)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Astro Skeleton Remnants`** (2 nodes): `Astro Framework`, `Site Favicon (Default Astro Logo)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `getPending()` and `api (API Client)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `setAuth()` and `Vitest Workers Config (worker tests, miniflare bindings)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Family interface` and `income_buckets reference table (AMI brackets)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `LookupForm (Name/Phone Search Form)` and `EnterPage (Check-in Flow Orchestrator)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `foodbox-data-app (Astro app on Cloudflare Workers)` and `React + Vite PWA Scaffold (src/pwa/)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Abby Repo Onboarding Guide` and `Plan 3: React PWA Check-In Flow`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `fetch()` connect `JWT & Session Auth Core` to `PWA API Client & Check-In Orchestration`, `Family & Visit Data Access`, `Auth API Routes & User Tables`?**
  _High betweenness centrality (0.153) - this node is a cross-community bridge._