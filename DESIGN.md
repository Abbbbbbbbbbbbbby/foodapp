# DESIGN.md — foodbox-admin

*Desktop-only internal console for CCF staff triaging live volunteer check-in issues on the foodbox-data-app PWA. Server-rendered Hono/hono-jsx, single page load per view, no client JS framework. Scope: `src/admin/**` only — the volunteer-facing PWA (`src/pwa/`) has its own UI and is out of scope here.*

**Labeling contract:** **RATIFIED** = verified shipped code (cited). **BLESSED 2026-08-21** = adopted going forward for the in-flight work (issues #17, #3); shipped code may not have it yet, and the gap is named, not hidden.

---

## Product brief

foodbox-admin is where CCF staff go when a volunteer reports the check-in app broke mid-shift. The single job of this UI: **let someone unfamiliar with the codebase find the right event, in seconds, while a volunteer is standing at a folding table waiting.** Every screen decision should be judged against that — not "does it look polished," but "does it get a staffer from confusion to the right row fast."

There is no non-technical end user here in the donor-platform sense — CCF staff, desktop, deliberately plain. But there's real time pressure: someone's on the phone with a stuck volunteer while they're looking at this screen.

---

## Design principles

- **Density over decoration.** This is a data-triage tool, not a marketing surface. A dense, scannable table beats a spacious, styled card every time.
- **Nothing is ever hidden from the record, only from the first glance.** Any field a human doesn't need for triage can be tucked away on-screen — but it must never be dropped from an export or a detail view. The console's job is decluttering, never data loss.
- **Null is data, not absence.** A missing volunteer name, an unset `occurred_at`, an unauthenticated device — these are facts worth a label ("not signed in"), never a blank cell that reads as broken.
- **White surface, on purpose.** No dark theme, no glass, no gradients. This isn't a stylistic gap to fill — a plain white console with high-contrast navy accents is the deliberate choice for a debugging tool used under fluorescent food-pantry lighting, possibly on borrowed hardware.

---

## Theme

**Single light theme, everywhere.** Unlike donation-platform's public/authenticated split, every route past `/login` and `/denied` requires OpenAuth — there's no acquisition-vs-relationship boundary here, no anonymous-facing surface at all. Don't propose a dark mode or a second register; there's no reachable path in this app that would use one.

---

## Color tokens (RATIFIED — de facto values from `src/admin/views/layout.tsx`)

```yaml
navy:        "#1d3557"
# Header background, all primary buttons/links styled `.btn`. The one strong
# accent color in the system. Never used for body text or table content —
# reserved for chrome and actionable elements.

body-text:   "#1a1a1a"
# Default text color, set on <body>. High contrast against the white/near-white
# background — this is a legibility tool, not a branded one.

surface:     "#fafafa"     # page background (<body>)
surface-alt: "#eef2f7"     # table header row background
white:       "#fff"        # table/card surfaces, header nav links on navy

border:      "#ddd"        # table cell borders, <pre> borders
border-input: "#bbb"       # form input/select borders

text-muted:  "#777"        # .muted — row counts, captions, secondary context
text-nav:    "#cde"        # header nav link color (on navy background)

status-denied: "#a33"
# .denied — the ONE reserved status color in the system, used exclusively for
# the "not authorized" page heading. Do not reach for red/error tones
# elsewhere without a real error state to report (see Don'ts).
```

**No status-ok / status-pending / status-info tokens exist yet.** The console currently has exactly one semantic state (denied/red). Client event `level` (`error`/`warn`/`info`) is rendered as plain text today — **BLESSED 2026-08-21**: when issue #17 ships, `level` should get a light background tint consistent with the org convention (never color-alone — the text label `error`/`warn`/`info` always stays present too). Don't invent a full traffic-light palette until a second real status dimension exists; one tinted-pill treatment for `level` is enough for now.

---

## Typography (RATIFIED)

No `--type-*` scale — plain HTML heading elements at browser defaults, sized down only where noted:

```yaml
body:    14px/1.5, -apple-system/system-ui/sans-serif   # set once on <body>, inherited everywhere
h1:      browser default (2em)                            # one per page — page title only
h2:      browser default (1.5em)                           # section headers within a page (event detail's "Breadcrumbs", "message", "stack")
table:   13px                                               # deliberately smaller than body text — density over the row grid
label:   12px, color #555                                   # filter form labels
muted:   12px, color #777                                   # .muted — row counts, captions
bignum:  64px/700                                            # .bignum — the ONE home-page metric (errors in last 24h). Never use for
                                                               # a second number on the same page; it reads as THE headline stat.
```

No monospace anywhere yet except `<pre>` blocks (message/stack/extra on the detail page) and inline `<code>` (event id). **BLESSED 2026-08-21**: table cells showing raw ids (`id`, `session_id`, `device_id`) should render in a monospace font when the column-visibility toggle (#17) reveals them — these are correlation strings a human copy-pastes, not prose, and monospace makes truncation/comparison easier. Human-facing columns (volunteer name, message, route) stay in the body sans-serif.

---

## Spacing

No formal scale — the shipped CSS uses ad hoc `4px`/`6px`/`8px`/`10px`/`14px`/`20px` values consistently within their own contexts (table cell padding `4px 8px`, filter gaps `10px`, page padding `20px`). Don't introduce a new spacing system for this console; match the nearest existing value when adding new UI rather than inventing a fifth gap size. When genuinely unsure, use `10px` — it's the most common gap value in the shipped file.

---

## Controls

**Primary button / link (RATIFIED — `.btn`, `.filters button`):**
```css
background: #1d3557; color: #fff; border: 0; border-radius: 4px;
padding: 6px 14px; cursor: pointer; text-decoration: none; display: inline-block;
```
Used identically whether it's a `<button type="submit">` or an `<a>` — the console doesn't distinguish button-vs-link styling, only the underlying element differs by whether the action is a form submit or a navigation. There is currently no secondary/quiet button variant and no destructive action anywhere in the console (it's read-only over the data — see Data display rules). Don't add a red/destructive button style unless a real destructive action ships; nothing today needs one.

**Header "quiet" button (RATIFIED — the logout button only):**
```css
background: none; border: 1px solid #557; color: #cde; border-radius: 4px; padding: 2px 10px;
```
A deliberately quieter treatment reserved for the header chrome (currently just "Log out"). Don't reuse this recipe in `<main>` content — it exists specifically for actions that live in the navy header bar, where the primary `.btn` navy-on-navy would disappear.

**Inputs / selects (RATIFIED — `.filters input, .filters select`):**
```css
padding: 4px 6px; border: 1px solid #bbb; border-radius: 4px; min-width: 120px;
```
**Gap, not yet shipped:** no explicit `:focus` / `:focus-visible` ring is set anywhere in the stylesheet — inputs rely on the browser's default focus indicator. **BLESSED 2026-08-21**: any new input control (the date-time pickers in #17) should get an explicit visible-focus style (a `2px` outline or box-shadow in the navy token) rather than continuing to rely on browser defaults, since this file is now the place that decision gets written down instead of silently inherited.

**Filter form layout (RATIFIED — `.filters`):**
```css
display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; align-items: end;
```
Each field is a `<label>` wrapping its text and the input/select directly (implicit label association — no `for`/`id` pairing needed, and this is the correct accessible pattern for a simple filter bar). New filter controls (the AZ date/time pickers, a future sort-direction control) should follow this exact `<label>Text<input/></label>` shape to stay in the flex row and keep the implicit a11y association.

**Tables (RATIFIED):**
```css
border-collapse: collapse; width: 100%; background: #fff; font-size: 13px;
th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: #eef2f7; position: sticky; top: 0; }
tr:hover td { background: #f2f6fb; }
```
Every data row is entirely clickable via a full-cell `<a>` (`td a { display: block }`) rather than a separate "view" link/icon — this is the established row-as-link pattern (`cell()` in `pages.tsx`) and should extend to any new clickable row, not introduce a second interaction style. `.truncate` (`max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) is reserved for long free-text columns (`message`, `stack`, `extra`) — never apply it to short structured fields (ids, timestamps, enums), which should show in full.

**Sortable column headers — BLESSED 2026-08-21 (issue #17, no prior shipped pattern):** a sortable `<th>` is the header text wrapped in a plain link (`<a>`) that toggles `?sort=col&dir=asc|desc` in the query string, matching the existing pager-link pattern (`pageQuery()` in `pages.tsx`) rather than introducing client-side JS sorting. Indicate the active sort column/direction with a small text arrow (`▲`/`▼`) appended to the header text — not a color change alone (color-alone would fail the never-color-alone rule below, and `th` background is already spoken for by `#eef2f7`).

**Column-visibility toggle — BLESSED 2026-08-21 (issue #17, no prior shipped pattern):** a single "Show all columns" checkbox above the table, styled as a plain `<label><input type="checkbox">Show all columns</label>` inline with the `.muted` row-count caption. This is a display-only client-side or query-param toggle — it must never change what `exportEvents()` / `/events.csv` returns (see Data display rules). Don't build a per-column show/hide menu; one all-or-nothing toggle matches this tool's "decision logic, not configuration surface" scale.

---

## States

**Empty state — gap, not yet shipped.** If `props.rows.length === 0`, `EventsPage` today renders a table with a header row and zero body rows — no "No events found" message. **BLESSED 2026-08-21**: add the donation-platform canon here too — plain, minimal, `text-align: center; color: #777; padding: 40px 0`, "No events match these filters." No illustration, no CTA (the filter form is already right above it).

**Volunteer-identity null state — BLESSED 2026-08-21 (issue #17):** when `client_events.user_id` is null (crashed/logged-out session) or the joined `users` row can't be found, render an explicit **"not signed in"** in `.muted` styling — never an empty cell. A blank cell in this column specifically would read as "lookup failed," not "nobody was logged in," and those are different facts a staffer needs told apart.

**Loading:** none needed — every route is a full server-rendered page load, no client-side async states exist or are anticipated. Don't add a spinner/skeleton pattern; there's nothing here that loads client-side.

**Focus:** see Controls — currently browser-default, `:focus-visible` styling is BLESSED for new inputs going forward (#17).

---

## Data display rules (binding — carried from the org rule set)

- **One fact per field, always.** `EVENT_COLUMNS` in `src/admin/db.ts` already follows this (RATIFIED) — one column per stored fact, nothing concatenated into a label string. Any new column (volunteer name, sort indicator) follows the same discipline: a new fact gets a new column, never appended prose.
- **Column-visibility is display-only.** The hide-low-signal-fields toggle (#17) must never change the shape of `exportEvents()`, `/events.csv`, or the event-detail page — those three surfaces always carry every field. This is the direct application of the "decluttering, never data loss" principle above; state it here so it survives contact with implementation.
- **XLSX exports (issue #3):** `write-excel-file` is the default writer — multi-sheet, frozen header row (`stickyRowsCount`), explicit column widths. It has **no autofilter support**; that's an accepted tradeoff for this console's scale, not an oversight — name it in the export UI or issue, don't silently ship a spreadsheet the reader expects to filter and can't. If autofilter ever becomes a hard requirement, the escalation path is `exceljs` (feature-complete, ~2 years stale — a deliberate step up, not a default). Never use npm `xlsx@0.18.5` (two unpatched HIGH advisories).
- **Timestamps:** stored and queried in UTC (D1 `datetime('now')` / client ISO). The events table should display `received_at`/`occurred_at` in **America/Phoenix local time** (fixed UTC-7, no DST — a real simplification, not a library dependency) for on-screen scanning; the event-detail page keeps UTC for precision when cross-referencing Workers logs. State which one a given screen shows — never leave a bare timestamp ambiguous about its zone.
- **Failure/staleness visibility:** any future indicator of a stale or failed state (a lookup that couldn't resolve, a query that timed out) gets a persistent on-page label, never a toast-only notification — there's no client JS to show a toast with anyway, but the principle matters if this console ever grows one.

---

## Accessibility floor

Not donor-facing, but this is the tool staff use to debug a volunteer's problem in real time — it deserves the basics, verified rather than assumed:

- **Labels:** every form control uses the implicit `<label>Text<input></label>` wrap (RATIFIED, `.filters` today) — keep this pattern; don't switch to placeholder-only labels (the current `from`/`to` inputs already correctly pair a real `<label>` with an ISO-format placeholder, not the reverse).
- **Semantic tables:** `<table>`/`<thead>`/`<tbody>`/`<th>` used correctly today (RATIFIED) — a sortable-header change must keep the `<th>` element and put the sort control inside it, not replace it with a styled `<div>`.
- **Color is never the only signal:** the one existing status color (`.denied`, `#a33`) is always paired with the word "Not authorized," never color alone. Any new status treatment (the `level` tint, the sort-direction arrow) follows the same rule.
- **Visible focus:** BLESSED for new inputs (#17) per Controls above — this is the one real gap between "shipped" and "AA-adjacent" in the current code, named rather than assumed fixed.

---

## Don'ts

```
- No dark theme, no glass surfaces, no gradients — this console is white/navy only, deliberately.
- No new status colors invented speculatively — level (error/warn/info) is the only status
  dimension planned; don't build a palette for states that don't exist yet.
- Column-visibility toggle is display-only — it must NEVER reduce what exportEvents()/
  events.csv/the detail page return. Hiding a column on screen ≠ dropping it from the record.
- Null volunteer identity is never a blank cell — always an explicit "not signed in" label.
- No color-alone status signaling — a text label accompanies every colored indicator.
- No client-side sorting/filtering JS — sort and filter are query-string round-trips through
  the server, matching how pagination already works. This console has no build step and no
  client JS bundle; don't introduce one for a feature that server-side sorting handles fine.
- No second button style tier (secondary/destructive) until a real use for one ships.
- No npm xlsx@0.18.5 for exports — write-excel-file is the default; exceljs is the only
  sanctioned escalation if autofilter becomes a hard requirement.
- No monospace on human-facing text columns (volunteer name, message) — reserve it for
  raw ids/correlation strings only.
```
