# Food Line Check-In App — Design Spec
_Date: 2026-05-20_

## Context

The Creighton Community Foundation runs community food distribution events where volunteer data collectors check in families as they drive up. The current tool is a Bubble.io web app that works but is not mobile-first and is increasingly strained by usability issues: older volunteers struggle with the small UI, bilingual interactions are rough, and spotty connectivity at outdoor sites causes friction.

This spec defines a replacement: a mobile-first Progressive Web App (PWA) hosted on Cloudflare infrastructure. It must preserve all existing data structure and logic from Bubble.io while delivering a dramatically faster, more accessible, and connectivity-resilient experience for volunteers of all ages and language backgrounds.

---

## Users & Roles

| Role | Count | Description | Access |
|---|---|---|---|
| **Admin** | 1–2 | Full access to the entire app. Manages accounts, controls which pages staff and volunteers can access, exports data. | All pages |
| **Staff** | Org employees | Can enter data and view all entered records and summaries. Cannot manage accounts or export data. | Enter data, view records, view summary |
| **Volunteer** | Community volunteers | Can only enter data. Cannot view existing records or any admin/summary pages. | Enter data only |

All three roles can self-register with name + phone. Role defaults to `volunteer` on self-registration. Admins promote accounts to `staff` or `admin` as needed.

---

## Architecture: Cloudflare Pages + Workers + D1

```
Browser (PWA)
  └─ Service Worker (offline queue, app shell cache)
  └─ IndexedDB (pending submission queue)
        │ sync when online
        ▼
Cloudflare Workers (API layer)
  └─ D1 (SQLite — primary datastore)
  └─ KV (session tokens)
  └─ SMS OTP via Twilio (auth)

Cloudflare Pages (CDN — serves PWA globally)
```

**Key properties:**
- Works with or without cellular signal. Submissions queue in IndexedDB and sync automatically when connectivity returns.
- No data is lost if a volunteer loses signal mid-event.
- D1's SQL model maps directly to the Bubble.io data export — migration is a SQL import.
- Zero-cost scaling (Workers + D1 bill per request, scale to zero between events).

---

## Data Model (mirrors Bubble.io, migrated to D1 SQLite)

### `families`
| Field | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | Primary family name |
| phone | TEXT | May be null |
| address | TEXT | |
| zip_code | TEXT | |
| date_of_birth | DATE | |
| language | TEXT | 'en' / 'es' / 'other' |
| ethnicity | TEXT | Option set value |
| hispanic | TEXT | 'yes' / 'no' / 'declined' |
| ami_bracket | TEXT | '<30%' / '30-50%' / '50-80%' / '80-120%' / '>120%' / 'declined' — raw income not stored |
| num_people | INTEGER | |
| num_children_under_18 | INTEGER | |
| num_children_under_5 | INTEGER | |
| num_with_diabetes | INTEGER | |
| health_insurance | TEXT | 'yes' / 'no' / 'declined' |
| snap_benefits | TEXT | 'yes' / 'no' / 'declined' |
| receives_texts | BOOLEAN | Currently receives texts |
| want_text_updates | BOOLEAN | Opted in to food distribution updates |
| id_confirmed | BOOLEAN | |
| bag_received | BOOLEAN | |
| first_visit_date | DATE | |
| created_by | TEXT | FK → users.id |

### `visits`
| Field | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| family_id | TEXT | FK → families.id |
| visit_date | DATE | |
| picked_up_by_phone | TEXT | Null = self pickup |
| volunteer_id | TEXT | FK → users.id |

### `proxies`
| Field | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| family_id | TEXT | FK → families.id |
| proxy_name | TEXT | |
| proxy_phone | TEXT | |
| proxy_form_ref | TEXT | Optional form reference |

> **Note:** Proxy UI (adding/managing proxy authorizations through a dedicated form) is deferred — scope TBD. The proxy data model is preserved and proxy relationships are still used to surface multi-family pickup at check-in time. The designated proxy captured during new family registration is stored here.

### `income_buckets` (analytics reference)
| Field | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| range_text | TEXT | e.g. "Less than 30% AMI" |
| graph_label | TEXT | Short label for charts |
| ami_pct_min | REAL | e.g. 0.0 |
| ami_pct_max | REAL | e.g. 0.30 |
| families_count | INTEGER | Denormalized count for analytics |

### `ami_thresholds` (app config, not a user-editable table)
Annual median income (Maricopa County, US Census Bureau) by family size, used client-side to calculate AMI bracket:

| Family size | Annual median income |
|---|---|
| 1 person | $59,347 |
| 2 people | $94,640 |
| 3 people | $115,062 |
| 4 people | $125,621 |
| 5 people | $121,268 |
| 6 people | $132,321 |
| 7+ people | $127,820 |

### `users`
| Field | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | Required — used for identification |
| phone | TEXT | Used for SMS OTP login |
| role | TEXT | 'admin' / 'staff' / 'volunteer' — defaults to 'volunteer' on self-registration |
| active | BOOLEAN | |
| self_registered | BOOLEAN | true if volunteer self-registered; false if admin-created |

---

## Authentication: SMS OTP

### Self-registration (volunteers)
1. Volunteer opens app, taps "Create account / Crear cuenta."
2. Enters their **full name** and **phone number.**
3. Twilio sends a 6-digit OTP.
4. Volunteer enters code → account created with role = 'volunteer', `self_registered = true`.
5. Account is immediately usable. Admin can deactivate or promote role at any time.

### Admin-created accounts (staff / admin)
- Admin creates account with name, phone, and role pre-assigned.
- Volunteer receives OTP on first login — same flow from step 3 above.

### Session
- JWT issued on successful OTP, stored in localStorage, 12-hour TTL, auto-refreshed silently.
- If a valid JWT is cached and device is offline, app continues working. Sync resumes when signal returns.

---

## App Pages

| Page | Volunteer | Staff | Admin | Notes |
|---|---|---|---|---|
| `/login` | ✓ | ✓ | ✓ | Phone + OTP; "Create account" link |
| `/` (home) | ✓ | ✓ | ✓ | Buttons shown based on role |
| `/enter` | ✓ | ✓ | ✓ | Core check-in flow |
| `/view` | — | ✓ | ✓ | Search individual family records |
| `/data/summary` | — | ✓ | ✓ | Aggregate summaries by timeframe |
| `/admin/accounts` | — | — | ✓ | Manage accounts; set roles; control page access |
| `/admin/export` | — | — | ✓ | CSV export of all data |
| `/account` | ✓ | ✓ | ✓ | Own account settings |

**Role-based home screen:** Volunteers see only "Enter Data." Staff see "Enter Data" and "View Records." Admins see all options including a link to admin tools.

**Page access management:** Admins can restrict or grant specific pages to staff and volunteer roles from `/admin/accounts` — no code change required.

> **Deferred:** `/enter/proxy-forms` (proxy authorization UI) — scope TBD.

---

## Core Check-In Flow (`/enter`)

### Step 0 — Look up the person at the window

The flow always starts the same way regardless of whether the person is new or returning. The volunteer asks for name and phone, the app searches, and routes automatically — no question asked of the client about whether they're in the system.

**Screen: Who is picking up today?**
- Name field (fuzzy search — tolerates misspelling)
- Phone number field (blank, no autofill)
- "Search / Buscar" button
- Both fields independently searchable or used together

---

### If results are found → Returning path

**Screen: Results**
- Ranked matches (exact phone first, then name fuzzy distance)
- Each result shows: name, partial phone, family size, last visit date
- "Not the right person → Register as new" at bottom

**Screen: Select families for this pickup**
- Person's own family (if found) shown first, labeled "Their own family / Su propia familia"
- All families where their phone appears in `proxies.proxy_phone`, labeled "Also picking up for / También recogiendo para"
- None pre-checked — volunteer taps each family being picked up today
- Running count: "X selected / X seleccionadas"
- "Confirm / Confirmar" button disabled until at least 1 family selected

**Screen: Log visit — per family (loops)**
- Family name + size + last visit shown at top
- "No change / Sin cambios" → marks visit and advances
- "Update info / Actualizar datos" → mini-edit wizard for that family
- After last family: "Done / Listo" → returns to home

---

### If no results found → New family path

The name and phone entered in the lookup are carried forward automatically — the volunteer does not re-enter them.

**Screen: How many families today?**
> "How many families are you picking up for today?"
> "¿Para cuántas familias está recogiendo hoy?"

Tap buttons: 1 / 2 / 3 / 4+

The volunteer then completes the registration wizard once per family. Name and phone are pre-filled for the first family (from the lookup); subsequent families start with blank fields.

---

**Before each family: Who usually picks up for this family?**

Asked once per family before its 11-step wizard:

> "Who usually picks up food for this family?"
> "¿Quién usualmente recoge los alimentos para esta familia?"

- **"The person here today / La persona aquí hoy"** → person from lookup is the designated pickup; saved to `proxies`
- **"Someone else / Otra persona"** → collect that person's name + phone (optional), saved to `proxies`
- **"No designated person / Sin persona designada"** → skip

---

**Wizard — 11 steps (repeated once per family)**

Every step shows both languages as full readable sentences — no labels, no "read aloud" markers. Both are displayed at equal size so the volunteer can read either one.

Name and phone are pre-filled from the lookup for the first family. Subsequent families start blank.

Progress bar visible throughout. Back and Skip available on every step.

| Step | English | Spanish | Input |
|---|---|---|---|
| 1 | "What is your full name?" | "¿Cuál es su nombre completo?" | Text input |
| 2 | "What is your phone number?" | "¿Cuál es su número de teléfono?" | Phone input + "I don't have one / No tengo" |
| 3 | "What is your zip code?" | "¿Cuál es su código postal?" | Numeric input |
| 4 | "What language do you prefer?" | "¿Qué idioma prefiere?" | English / Español / Other / Prefer not to say |
| 5 | "How many people live in your household?" | "¿Cuántas personas viven en su hogar?" | Tap: 1 / 2 / 3 / 4 / 5 / 6 / 7+ → if 7+, numeric input for exact count |
| 6 | "How many children under 18 live in your household?" | "¿Cuántos niños menores de 18 años viven en su hogar?" | Tap: 0 / 1 / 2 / 3 / 4 / 5 / 6+ |
| 7 | "How many children under 5 live in your household?" | "¿Cuántos niños menores de 5 años viven en su hogar?" | Tap: 0 / 1 / 2 / 3 / 4 / 5+ |
| 8 | "How often do you get paid? And about how much each time?" | "¿Con qué frecuencia le pagan? ¿Y aproximadamente cuánto cada vez?" | Sub-step A: Weekly / Every 2 weeks / Monthly / Yearly / Prefer not to say. Sub-step B (if not declined): numeric dollar amount. App calculates AMI bracket silently — only bracket stored, not raw income. |
| 9 | "Does your family currently receive SNAP benefits?" | "¿Su familia recibe beneficios de SNAP actualmente?" | Yes / No / Prefer not to say |
| 10 | "Does anyone in your family have health insurance?" | "¿Alguien en su familia tiene seguro de salud?" | Yes / No / Prefer not to say |
| 11a | "Do you currently receive text messages?" | "¿Actualmente recibe mensajes de texto?" | Yes / No / Prefer not to say |
| 11b | _(shown only if 11a = Yes)_ "Would you like to receive text updates about food distribution events?" | "¿Le gustaría recibir actualizaciones por mensaje de texto sobre eventos de distribución de alimentos?" | Yes / No |

Step 11b triggers SMS enrollment via Twilio (same API integration as Bubble.io) if the client answers Yes.

After step 11: marks visit, saves record. Shows:
- "Next family in this car / Otra familia en este auto"
- "Next person / Siguiente persona"

---

## Income Bracket Calculation (client-side, step 8)

Pay period multipliers to annualize:
- Weekly × 52
- Every 2 weeks × 26
- Monthly × 12
- Yearly × 1

AMI bracket thresholds (Maricopa County, US Census Bureau). Bracket = annual income ÷ AMI for family size:

| Bracket stored | Condition |
|---|---|
| `<30%` | annual income < 30% of AMI |
| `30-50%` | 30% ≤ annual income < 50% of AMI |
| `50-80%` | 50% ≤ annual income < 80% of AMI |
| `80-120%` | 80% ≤ annual income < 120% of AMI |
| `>120%` | annual income ≥ 120% of AMI |
| `declined` | client chose "Prefer not to say" |

Raw income amount and pay period are **not stored**. Only the bracket is saved to `families.ami_bracket`. The bracket calculation happens entirely on-device before submission.

Family size used for bracket lookup = `families.num_people` collected in step 5.


---

## Data Summary Page (`/data/summary`)

Accessible to staff and admin. Based on the Bubble.io `view_data` page.

**Controls:**
- Date range selector: Last event / This month / Last 3 months / Custom range (date pickers)

**Summary cards (aggregate for selected period):**
- Total families served
- Total individuals served (sum of `num_people` for visits in period)
- New families registered vs. returning families

**Charts / breakdowns:**
- AMI bracket distribution (% of families in each bracket)
- Ethnicity breakdown
- Language preference breakdown
- SNAP benefits: % Yes / No / Declined
- Health insurance: % Yes / No / Declined
- Top zip codes served (count of families per zip)
- Visits over time (bar chart by week or month)

---

## Lookup: Fuzzy Search

- **Phone:** exact match on normalized digits (strip non-numeric characters)
- **Name:** Levenshtein distance ≤ 2 on first token, ≤ 3 on full string; ranked by distance
- **Combined:** union, deduplicated, ranked (exact phone first, then name distance)
- **Proxy expansion:** after matching a person, also return all families where their phone is in `proxies.proxy_phone`

Search runs against D1 via a broad `LIKE` pull, with client-side distance ranking for fuzzy. Dataset size (~few thousand records) makes this fast.

---

## Offline Strategy

1. App shell cached on first load — launches instantly with no signal.
2. Family lookup requires network — offline banner shown if unavailable.
3. Submissions (new families, visit records) queue in IndexedDB immediately; sync to Workers/D1 when signal returns.
4. Valid JWT in localStorage = app keeps working offline once logged in.
5. Conflict handling: visit records are append-only (no conflict possible). New family dedup uses phone as soft key on sync — later record wins, flagged for admin review.

---

## Bilingual Design Rules

- Every data-entry question displays both English and Spanish as full sentences — equal size, equal prominence, no directional labels.
- All button labels bilingual: "Yes / Sí", "No / No", "Search / Buscar", "Confirm / Confirmar", "Prefer not to say / Prefiero no responder."
- Language preference saved per family; pre-shown on returning visits.
- Admin screens (export, accounts) are English-only.

---

## Accessibility & Usability Requirements

- Minimum touch target: 48×48px on all interactive elements.
- Minimum font: 16px body, 20px+ for question text.
- High contrast dark theme — readable in direct sunlight.
- No time-outs on data entry screens.
- Destructive actions (delete, clear form) require a second tap to confirm.
- "Prefer not to say / Prefiero no responder" available on every sensitive field — never blocks submission.

---

## Data Migration

Source: `food-data.bubble` (682KB JSON) in `~/Downloads`.

Migration steps:
1. Parse Bubble.io `user_types.family_data` → insert into `families`. Map `income_number` + `income_unit_of_time` → recalculate `ami_bracket` using AMI thresholds; discard raw income.
2. Parse `visit_dates_list_date` per family → one row per date in `visits`.
3. Parse `proxies_list_text` + `proxy_phone_numbers_list_number` per family → insert into `proxies`.
4. Parse `user_types.user` → insert into `users`.
5. Cross-check with `appdata20260213.csv` for name/phone consistency.

Migration script: one-time Node.js script reading Bubble JSON → emits SQL INSERTs for D1.

---

## Admin Features (preserved from Bubble.io)

- **View records** (`/view`): search individual families by name or phone; view visit history; edit records.
- **Data summary** (`/data/summary`): aggregate analytics by timeframe (staff + admin).
- **Export** (`/admin/export`): CSV of all family + visit data, filterable by date range.
- **Manage accounts** (`/admin/accounts`): add, deactivate, or promote volunteer accounts.

---


---

## Verification

| Test | How |
|---|---|
| Self-registration | New volunteer registers via phone + name; account appears in admin accounts list with `self_registered = true` |
| Offline check-in | Airplane mode → complete new family registration → restore network → confirm visit appears in D1 |
| Unified lookup routing | Search for known family → returning path shown; search for unknown → new path with family count prompt |
| Fuzzy name search | Search "Gonzales" when stored as "Gonzalez" — match surfaces |
| Proxy multi-family | Family A has phone X as proxy; look up phone X at check-in — family A appears in proxy section |
| AMI bracket | Enter weekly income of $700 for family of 4 ($36,400/yr); confirm bracket stored is `<30%` ($125,621 × 30% = $37,686) |
| SMS enrollment | Step 11b Yes → Twilio enrollment triggered; family `want_text_updates = true` |
| Bilingual display | All 11 wizard steps show EN and ES at equal size with no directional labels |
| Data summary | Select "Last month" → totals, bracket distribution, and charts reflect only visits in that period |
| Data loss on crash | Kill browser tab mid-form; reopen — IndexedDB queue preserves entered data |
