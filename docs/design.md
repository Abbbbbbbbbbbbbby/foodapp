# CCF Food Distribution App — Design Standards

## Brand Colors

Source: Creighton Community Foundation logo (`ccf_logo_tagline_OUT.ai`)

| Pantone | Role | Hex |
|---------|------|-----|
| PMS 130 C | Gold — fills, highlights, interactive backgrounds | `#F7A800` |
| PMS 661 C | Navy — text, accent-as-text, primary identity color | `#003594` |

## CSS Tokens (`src/pwa/styles/global.css`)

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#F4F1E8` | Page background (warm cream) |
| `--surface` | `#FFFFFF` | Card / panel background |
| `--surface-2` | `#E8E4D8` | Input fields, secondary fills |
| `--border` | `#CECABC` | Dividers, input outlines |
| `--text` | `#1E3266` | Primary text (lightened navy) |
| `--text-muted` | `#44588A` | Labels, meta, secondary text |
| `--accent` | `#F7A800` | PMS 130C — button backgrounds, progress bars, active underlines, selection borders |
| `--accent-dark` | `#C48500` | Hover / focus state of accent elements |
| `--accent-text` | `#003594` | PMS 661C — accent color used _as text_ on light surfaces (nav active, tab active, avatar letters, links) |
| `--danger` | `#850019` | Error states, destructive actions |
| `--success` | `#073A0B` | Confirmation states |
| `--radius` | `10px` | Border radius for all cards and buttons |
| `--touch` | `48px` | Minimum tap target height |

### Accent color rules

`--accent` (gold) must **never** be used as text color on white or cream surfaces — it fails WCAG AA contrast (1.4:1 on white). Use `--accent-text` (navy) instead:

- Active nav tab: `color: var(--accent-text)` + `border-bottom-color: var(--accent)`
- Active records tab: same pattern
- User avatar initials: `color: var(--accent-text)`
- Collapsible links: `color: var(--accent-text)`

Gold _is_ correct on button backgrounds (`.btn-primary`, `.timeframe-btn-active`, `.btn-tap:active`) because black text on gold achieves 14.5:1 contrast.

## Typography

System sans-serif stack: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

No custom typefaces — the app targets Safari 9 on iPad 2 (no WOFF2 guaranteed) and must remain fully functional offline without font network requests.

| Class | Size | Weight | Usage |
|-------|------|--------|-------|
| `.question-en` | 22px | 600 | Primary wizard question |
| `.question-es` | 22px | 400 | Spanish translation of question |
| `.sub-question` | 16px | 400 | Period selector sub-prompts |
| `.btn-option` | 18px | 400 | Selectable answer buttons |
| `.btn-large` | 20px | 700 | Primary action (Next / Submit) |
| Body | 16px | 400 | General body text |
| `.wizard-progress`, `.progress-label` | 13px | 400 | Step counter |

## Component Conventions

### Buttons

`.btn-primary` — gold background (`--accent`), black text, `font-weight: 700`. Use for primary forward action.

`.btn-ghost` — transparent background, muted navy text. Use for Back / skip links. Left-aligned text.

`.btn-option` — white card with border. Use for wizard answer choices. Supports two lines: English on top, Spanish muted below.

`.btn-tap` — compact square tap target for numeric grids. Active state: gold background, black text.

### Spacing / layout

- Cards and sections: flex column with `> * + * { margin-top: Npx }` instead of `gap` (Safari 9 flex gap support is inconsistent).
- Main content area: `max-width: 600px`, centered.
- Minimum touch target: `48px` (`--touch`).

## Platform Constraints (Safari 9 / iPad 2)

- No CSS Grid — use flexbox with `flex-wrap`.
- No `gap` on flex — use `margin` on children.
- No `dvh` — use `vh`.
- No `toLocaleString()` for number formatting — use regex comma insertion.
- No WOFF2 web fonts — use system stack only.
- All vendor prefixes required: `-webkit-box`, `-ms-flexbox`, `-webkit-transform`, etc.
- ES5 only in the legacy bundle — no arrow functions, no template literals, no destructuring in polyfilled paths.

## Bilingual Text Convention

Every user-facing string appears in both languages, English first:

- Question text: two separate elements (`.question-en`, `.question-es`)
- Button labels inline: `"Continue / Continuar"`
- Option buttons with sub-labels: English `<span>`, Spanish `<span style="font-size:13px; color:var(--text-muted)">` as second child
