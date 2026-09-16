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

`.btn-primary` — gold background (`--accent`), navy text (`--text`), `font-weight: 700`. Use for primary forward action.

`.btn-ghost` — `--surface-2` background, no border, muted navy text. Use for Back navigation only. Left-aligned text.

`.btn-option` — white card with border. Use for wizard answer choices, including skip/decline options ("Don't know / Prefer not to say"). Supports two lines: English on top, Spanish muted below.

`.btn-tap` — compact square tap target for numeric grids. Active state: gold background, black text.

### Form Elements

**Base rule (`global.css`):** `input, select, textarea { width: 100%; min-height: var(--touch); padding: 12px; ... }` — full-width, touch-friendly fields. Correct default for every text-like control (text, date, number, select). **Do not** let a checkbox or radio fall through to this rule — see below.

**Checkboxes / radios (`global.css`):**

```css
input[type="checkbox"], input[type="radio"] {
  width: 20px; height: 20px; min-height: 0; padding: 0;
  flex-shrink: 0; cursor: pointer;
}
```

This rule has higher specificity than the base `input` rule above, so it always wins — no per-component override is ever needed for sizing. **Why this exists:** Safari/WebKit paints a checkbox or radio at its native small size regardless of CSS `width`, but still *allocates flex-layout space* per the CSS box. Without this rule, an unsized checkbox/radio inside a flex row silently stretches to fill the row (inheriting `width: 100%` from the base rule) and pushes its own label text outside the row — invisible in Chromium devtools, broken in real Safari. This shipped to production twice (the duplicate-merge "Keep" radio, then the entire Export Data page and the account-delete checkbox) before being caught, purely because it only shows up in WebKit. **Always check new/changed checkbox or radio layouts in WebKit specifically** (`npm run test:e2e` runs both `chromium` and `webkit` projects) — Chromium alone will not catch this.

**Labels wrapping a checkbox/radio beside inline text:** the bare `label { flex-direction: column }` rule (`global.css`) is the correct default for the dominant "Text above input" question pattern (`<label>Visit date<input type="date"></label>`). It is **wrong** for a horizontal "`[ ] Option text`" row, and CSS cascade means it silently wins for `flex-direction` on any label that doesn't declare that property itself — even one with a more-specific class selector, since specificity is compared per-property, not per-rule. Every label wrapping a checkbox/radio beside text must explicitly set `flex-direction: row` (and `align-items: center`):

- Class-based labels: add `flex-direction: row; align-items: center;` directly to the label's own class rule (see `.records-checkbox-label`, `.admin-confirm-checkbox-label` in `global.css`).
- Inline-styled components: add `flexDirection: 'row'` to the label's inline `style` object (see `SummaryScreen.tsx`, `ExportPage.tsx`).

Never rely on the bare `label` default for this case, even if it "looks fine" in a quick check — verify in WebKit.

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
