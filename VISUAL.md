# BioSCom visual cheatsheet (working notes for the `visual` branch)

## What the app is
Lab chemical inventory system. Frontend = Svelte 5 + Vite (TypeScript), single-page app in `web/`.
Backend `server/` (Fastify + SQLite) is irrelevant for pure visual work — it only serves `web/dist`.

## Repo layout (visual-relevant)
```
web/src/
├── app.css               ← THE stylesheet. One global file (~1950 lines), no CSS frameworks,
│                            no scoped component styles worth noting
├── main.ts → App.svelte → components/AppShell.svelte (36KB giant: header, nav, modals, wiring)
├── components/
│   ├── views/            10 route views (Rooms, Containers, Detail, History, Instruments,
│   │                     Minigames, Noticeboard, Printing, Protocols, Assets)
│   ├── modals/           12 form modals (all share the .modal/.form-* classes)
│   ├── AppShell / LoginOverlay / GlobalSearch / CaptchaBody / Modal / OfflineBanner / Toasts
├── lib/
│   ├── theme.svelte.ts   dark⇄lite toggle: body.lite-mode, persisted in localStorage "bioscom-theme"
│   ├── router.svelte.ts  hash router
│   └── stores/*.svelte.ts  Svelte-5-runes state (session, inventory, toast, connection…)
└── assets/Capcha/        frog images for the biology captcha
```
Root-level `BioSCom.html`, `style.css`, `app.js`, `core.js`, `index.html` = the legacy monolith the
Svelte app was ported from. Baseline for parity only — do not edit.

## How the styling works
- **All colors/spacing are CSS custom properties** in `:root` at the top of `app.css`:
  `--bg-primary/secondary/card/card-hover/input/modal`, `--text-primary/secondary/muted`,
  accents (`--accent-blue/purple/teal/pink/amber/red/green/cyan/indigo`),
  three gradients (`--gradient-primary` blue→purple, `--gradient-fridge`, `--gradient-freezer`),
  borders, shadows, radii (`sm/md/lg/xl`), `--font-family` (Inter), `--transition-fast/normal`.
- **Light theme = variable swap only**: `body.lite-mode` overrides the same vars (app.css ~line 928).
  Any new component styling should use the vars so lite mode keeps working.
- **Theming convention**: color-family-coded entity types — cabinet=purple, fridge=teal/cyan,
  freezer=indigo, instrument=amber/red, 3D-print=green. Keep this language consistent.
- Ambient background = two `body::before/::after` fixed layers (radial glows + dot grid, animated).
- **No code comments** is a repo-wide convention; CSS section banners `/* Header */` style already
  exist in app.css and are the accepted exception — keep them that shape if adding sections.

## Theme system (added on `visual` branch)
- **Design theme** (Original / Bauhaus): `body[data-design="original|bauhaus"]`, set by
  `web/src/lib/theme.svelte.ts` (`theme.design` reactive getter, `setDesign()`, `initTheme()`),
  persisted in localStorage **`bioscom-design`**.
- **Dark/Lite mode** stays the old mechanism: `body.lite-mode`, localStorage `bioscom-theme`.
  Orthogonal, but the dropdown "Toggle Lite Mode" item is hidden when design=bauhaus
  (bauhaus is light-only for now).
- **Bauhaus overrides live at the END of `app.css`** under `/* Bauhaus Theme */` — after
  lite-mode — so `body[data-design="bauhaus"]` wins equal-specificity ties via source order.
  Original needs zero overrides (it is the default cascade).
- Settings modal: `web/src/components/modals/SettingsModal.svelte`, opened from the user
  dropdown (`#btn-open-settings` in AppShell), theme picker styles in `/* Settings */` section.
- Default for everyone is `original` → zero visual change for existing users; login parity test
  unaffected (dropdown isn't in the screenshot, attribute alone changes nothing).
- **Nav visibility** (`bioscom-nav` localStorage JSON map view→bool): `lib/stores/navPrefs.svelte.ts`
  (`NAV_ITEMS` defs + `navPrefs.visible/setVisible`). Settings modal has checkboxes for every tab
  except List of Chemicals (always on); 3D Print + Mini-games default OFF. Filtering is applied in
  AppShell tab markup ONLY under bauhaus (`{#if design !== "bauhaus" || navPrefs.visible(v)}`) so
  Original and its e2e tests (click #tab-printing/#tab-minigames) are unaffected; hidden routes
  still work via hash.
- **Bauhaus identity** = template `inspiration/index.html|inventory.html` (authoritative; chemicals.html
  missing). Palette: ink #171512, paper #F4F0E6, baured #DE2C1E, baublue #1D4FA2, bauyel #F0B62B.
  Type: Jost display / Inter body / IBM Plex Mono data (google-fonts link in web/index.html).
  Chrome: 2px ink borders, radius 0, no shadows, shape glyphs (::before squares/circles), selection
  red, ink scrollbar, 2px blue focus outline. Brand: LABHAUS + "Lab Operations" + 58x20 SVG mark
  (circle/triangle/rect) — design-gated markup in AppShell `.logo` and LoginOverlay `.login-logo`
  ({#if design==="bauhaus"}), original BioSCom DOM intact in {:else} branch.
- **Bauhaus sidebar shell** (app.css `/* Bauhaus Theme — Sidebar Shell */`): 256px fixed white
  border-r-2 ink, via `.header-top/.header-actions/.header-bottom { display:contents }` + flex `order`
  on .header-inner (brand→search→nav(scroll)→user tile). `.main-nav` forced `display:flex !important`,
  `#breadcrumb` hidden `!important`. Brand block 80px border-b-2. Nav sections
  (.nav-section-a/b/c/d: Overview/Workspace/Assets/Extras, gated incl. visibility-aware empties);
  tabs = px-6 rows, border-l-4 transparent, hover paper, active ink bg + colored edge via per-tab
  --c (#tab-inventory red, protocols blue, noticeboard yellow, history ink, assets blue, instruments
  red, printing yellow, minigames ink). User tile at bottom: 36px bauyel square initials +
  name/role (.user-tile-*, person svg hidden under bauhaus). ≤900px: static top bar, horizontal
  scrollable tabs w/ bottom-edge active, sections hidden, tile avatar-only.
- CSS structure at app.css tail (all scoped body[data-design="bauhaus"], append-only convention):
  Settings (global, new modal only) → Tokens/Type/Controls → Sidebar Shell → Content →
  Overlays & Widgets (~line 1950 onward, ~1470 lines, 0 deletions vs original).
- **Dashboard home** (`components/views/DashboardView.svelte`, gated `{#if design==="bauhaus"}`):
  stats row (chems/containers/instruments/week bookings, 10px top-accent + .stat-glyph shapes),
  Attention (quantityClass!=="ok", qty asc, max 8), Today's reservations (bookings date==today,
  live/queued/done), Activity log (history first 7), Shared containers. Route `dashboard` in
  TOP_VIEWS; `defaultView()` = dashboard (bauhaus) / rooms (original). NOTE: theme.svelte reads
  `bioscom-design` at MODULE INIT (readStoredDesign) because router's initial parseHash evaluates
  during import — before initTheme() runs. Keep that ordering intact.
- **Nav regroup (bauhaus)**: CSS `order` on .nav-tabs-bar children (DOM order untouched): Overview/
  Dashboard=10/11, Assets=20 (Chemicals 21, Inventory 22), Workflows=30 (Protocols 31, Reservations
  32), Extras=40 (Notice 41, 3D Print 42, History 43, Mini-games 44). Bauhaus labels: Chemicals/
  Inventory/Protocols/Reservations/History (+Dashboard); Settings toggles show them via
  NAV_ITEMS.labelBauhaus; #tab-dashboard{--c red}.
- **Emoji purge (bauhaus)**: ~20 .svelte/.ts files design-gate every app-rendered emoji; icon slots
  → `<span class="glyph glyph-{square|circle|tri}-{red|blue|yellow|ink}" aria-hidden>`; decorative
  text omitted; stored DATA emoji (cont.emoji, shelf icons) ignored under bauhaus; chess → KQRBNP;
  radio "▶/II". Skipped deliberately: PDF exports + user-typed content. Glyph CSS in `/* Bauhaus
  Theme — Glyphs, Nav Order & Dashboard */` (default 10px, .card-icon 14px, .empty-icon 32px +
  font-size:0 parent, `.glyph-box` = currentColor for custom box colors).
- QA: typecheck 0 errors; 9/9 web tests; build ok; templated identity verified via computed-style
  suites in `%TEMP%\opencode\bauhaus-qa\`: tpl-assert.mjs (59 PASS incl. original regression),
  tpl-nav-check.mjs (8 PASS: nav visual order desktop+mobile, dashboard default route, zero-emoji
  DOM scan, glyph render, stat accents, row split). Screenshots tpl-01..09 + tpl-09-dashboard.
  CANNOT self-review pixels on this model — human eyeball pass recommended.
- Known leftovers (inline-style-locked or next-pass): NoticeboardView inline category colors/badges,
  InstrumentsView booking rows, MinigamesView panels, AssetsView room h3s, superadmin-console looks,
  barcode img framing, `.instrument-card`/`.booking-*` classes dead in markup, `.shelf-count`/
  `.booking-time` deliberately demoted from chips to mono meta text. Dark bauhaus variant uncreated.

## Style map inside app.css (line anchors, may drift)
tokens :root 1 · containers split 70 · header/logo/nav-pill 77 · buttons 186 · main/view 227 ·
card-grid/.card 237 · search 276 · shelves 288 · chemicals-table 325 (fixed col widths!) ·
modal/form 403 · toast 444 · responsive @768 458 · autocomplete 612 · assets 665 · login 772 ·
lite-mode 927 · dropdowns 959 · nav-tabs 1029 · instruments 1081 · printing/3dprint 1162 ·
deepfreezer 1390 · lab radio widget 1582 · freezer grid/slots 1694 · chess/quiz 1804–1901 ·
focus-visible 1927 · reduced-motion 1937

## HARD constraints before touching visuals
1. **Class/ID names are load-bearing.** e2e tests query legacy selectors: `#view-rooms`,
   `.view.active`, `#tab-printing`, `.main-nav`, `#breadcrumb`, `#login-overlay`,
   `#auth-lab-select`, `#auth-panel-welcome`, `#btn-edit-container`, `#btn-delete-container`.
   Restyle freely, rename nothing without updating tests.
2. `tests/parity/task-14-login-parity.spec.ts` does a **pixel-diff of the login screen against the
   DEPRECATED legacy app** (bioscom-ca01a.web.app, ≤2% diff). Any intentional redesign will break
   it by definition — decide per-change whether to update/disable the baseline or accept red.
3. Convention: no CSS frameworks, no renamed legacy classes, strict TS
   (`npm run -ws --if-present typecheck` must stay clean).
4. Keep `body.lite-mode` parity for anything added (either uses vars, or add lite override).
5. Respect `@media (max-width:768px/480px)` blocks and `prefers-reduced-motion` / `:focus-visible`
   sections at the bottom of app.css.

## Verify loop (visual work)
```bash
npm run dev -w server        # API :8003 (+WS)
npm run dev -w web           # Vite :5173, proxies /api + /ws
npm run -ws --if-present typecheck
npm test -w web              # 9 fast store tests
npx playwright test          # full E2E incl. parity (slow, spawns scratch stack :8003)
```
Orphaned dev servers hold :8003 after cancelled E2E: `pkill -f "node server/dist/index.js"`.
