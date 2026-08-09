# Mobile Overhaul — Xomforms Frontend

**Status:** Implemented — pending real-device verification
**Owner:** Dominick
**Branch:** `feat/mobile-overhaul`
**Trigger:** Reese couldn't complete a poll on their phone — "having a hard
time scrolling the calendar to select date and times." Mobile is the primary
surface for respondents (share link → phone), so this is a P0 product gap, not
a polish item.

---

## 1. Root Cause of the Reported Bug

`availability-grid.component.scss:118`

```scss
.grid {
  touch-action: none;   // ← traps every touch gesture on the grid
}
```

combined with `availability-grid.component.ts:onPointerDown`:

```ts
ev.preventDefault();    // ← kills the fallback gesture too
```

`touch-action: none` tells the browser "never interpret a touch here as a pan
or zoom." It was carried over from the Phase 0 prototype to stop mobile Safari
hijacking a paint-drag as a page scroll. It does that — and also makes the grid
a **total touch trap on both axes**:

| Gesture on the grid | Intended | Actual |
|---|---|---|
| Swipe left/right | Pan to later days | Paints a horizontal streak of cells |
| Swipe up/down | Scroll the page | Paints a vertical streak of cells |
| Tap | Toggle one cell | Works |

Two knock-on effects make it worse:

1. **The horizontal scroll is unreachable.** `.grid-scroll` is
   `overflow: auto`, and the template renders a hint reading *"Swipe the grid
   sideways to see every day →"* (`availability-grid.component.html:47`). The
   child's `touch-action: none` overrides it — that swipe cannot scroll, it can
   only paint. **We are actively instructing users to perform the one gesture
   that is broken.**

2. **The grid is taller than the screen, so there is nowhere else to touch.**
   At the `≤480px` breakpoint, cells are `min-height: 44px`. A typical evening
   poll (5–10pm, 30-min blocks) is 11 rows ≈ 484px + headers; an all-day poll is
   2,000px+. On a 390×844 iPhone the grid fills the viewport, so a user trying
   to scroll down the page has almost no safe area to start the gesture from —
   and every attempt paints cells they didn't want.

**This single pair of lines accounts for the entire reported symptom.** It is
also why the complaint was "scrolling," not "the buttons are too small."

### Width check (secondary)

At 390px viewport: page padding 16px × 2 → 358px usable. Grid at `≤480px` is
`64px` label + `7 × 44px` cells = **372px**. It overflows by ~14px, so
horizontal scrolling is *required* for a standard 7-day poll — via the gesture
that doesn't work.

---

## 2. Audit — Wider Mobile State

The app is not mobile-broken everywhere, but it is desktop-first with mobile
retrofitted. Evidence:

| Signal | Count | Reading |
|---|---|---|
| `@media (max-width: …)` blocks in the whole app | **14** | Across 6,071 lines of SCSS. Retrofit, not a strategy. |
| Components with **zero** mobile media queries | 11 of 23 | Includes `user-menu`, `styled-select`, `styled-date`, `field-renderer`, `location-picker`, `qa-results` |
| `@media (pointer: coarse)` | **0** | Touch is never treated as a distinct input mode |
| `env(safe-area-inset-*)` | **0** | Content can sit under the iPhone home indicator / notch |
| `dvh` / `svh` units | **0** | `100vh` used in `styles.scss:150` and `_auth-shell.scss:7` — the classic iOS Safari bug where the URL bar covers the bottom of the layout |
| Breakpoints in use | 420 / 480 / 560 / 640px | Four ad-hoc values; `$breakpoint-sm: 576px` exists in `_tokens.scss` and is **never used** |

Specific problem areas beyond the grid:

- **`poll-create`** — 425 lines of template, 779 of SCSS, **2** media queries.
  The creator flow on a phone is essentially untested.
- **`overlap-heatmap`** — shrinks cells to `34px` and 11px type on mobile
  (`$text-3xs`, which `_tokens.scss` explicitly reserves for "dense admin chrome
  ONLY"). Results are the payoff screen and they're the least legible.
- **`dashboard` / `admin-panel`** — modals are `position: fixed` with a
  `max-width` but no safe-area padding or `dvh` height handling.
- **Tap targets** — 54 button rules use ≤8px padding. With 13px type that lands
  near 30px tall, below the 44px baseline.
- **Hover-dependent affordances** — `.paint-cell:hover`, `.preset-btn:hover`
  etc. have no coarse-pointer equivalent; on touch, hover styles stick after tap.

---

## 3. The Open Design Question

Everything above except one item is mechanical. The one real decision:

> **Does the availability grid stay a pan-and-paint grid on phones, or get a
> purpose-built mobile interaction?**

**Option A — Fix the gesture model, keep the grid.**
Let the browser own panning; paint only after an explicit intent signal
(long-press to start painting, or a "Paint / Scroll" mode toggle). Days still
scroll horizontally.
*Cheap, preserves one mental model, keeps desktop untouched. Still asks people
to pan a wide grid on a small screen.*

**Option B — Different layout on mobile: one day at a time.**
Phone shows a single day as a full-width vertical list of time blocks with
day-switcher chips / swipe-between-days. No horizontal panning at all; vertical
scroll is native and unambiguous; tap targets get the full screen width.
*Best mobile UX, biggest build, two layouts to maintain.*

**Option C — Both, staged.** Ship A as the fix now; build B behind the
`≤560px` breakpoint as the real overhaul.

**DECIDED: Option B — rebuild the mobile layout now.** Phase 0 is skipped;
Dominick accepted that Reese stays blocked until Phase 2 ships, in exchange for
not building a throwaway interim gesture model.

Note: Phase 2 removes the touch trap under 560px by replacing that layout
entirely, so the hotfix is subsumed there. The `touch-action` repair still
happens on the desktop grid, because touch tablets from 560–1024px keep using
it and would otherwise inherit the same trap.

**Scope: full overhaul — all screens, plus guardrails.**

---

## 4. Phases

### Phase 1 — Mobile foundations (no visual redesign)
- Consolidate the four ad-hoc breakpoints onto the `_tokens.scss` scale; add a
  shared `_responsive.scss` with `mobile` / `tablet` / `coarse-pointer` mixins.
- `100vh` → `100dvh`; add `env(safe-area-inset-*)` to the header, fixed modals,
  and page bottoms.
- Wrap all `:hover` rules in `@media (hover: hover)`.
- Raise interactive elements to a 44px minimum via a shared control mixin.

### Phase 2 — Grid mobile layout (Option B)
Single-day vertical list under 560px, day switcher, swipe between days. Shares
selection state and `GridBlock` model with the desktop grid — presentation
only, no data-model change.

### Phase 3 — Per-screen passes
Priority order by respondent impact: `poll-view` → `overlap-heatmap` →
`poll-create` → `dashboard` → `admin-panel`. Each gets a real-device pass.

### Phase 4 — Guardrails
- Stylelint rule rejecting raw px breakpoints outside the token scale.
- A documented device matrix (iPhone SE 375px, iPhone 15 393px, Pixel 412px)
  checked before merge on any UI PR.

---

## 4b. What Shipped

| Phase | Status | Notes |
|---|---|---|
| 1 — foundations | Done | `src/styles/_responsive.scss`; 15 raw breakpoints → mixins; 74 `:hover` rules guarded; `dvh`; safe-area; 44px targets under `pointer: coarse` |
| 2 — grid rebuild | Done | Day-at-a-time phone layout; desktop grid `touch-action` repaired for touch tablets; 14 new tests |
| 3 — per-screen | Done | See below |
| 4 — guardrails | Done | Stylelint `media-feature-name-value-allowed-list` rejects raw px breakpoints |

Verification: `npm run build:prod` clean, `npm run lint:css` clean, 193/193 tests
passing (was 179 — 14 added).

Per-screen changes in Phase 3:
- **poll-create** — `.field-row` now wraps at a 200px flex-basis. Five two-up
  rows (start/end date, earliest/latest start, close-at date+time, scale
  min/max) were staying side by side at 390px, giving each side ~170px while
  `xf-date`'s popover alone needs 268px. `.share-row` stacks so the share URL
  isn't showing a third of itself.
- **overlap-heatmap** — type raised off `$text-3xs` in three places.
  `_tokens.scss` reserves 11px for "dense admin chrome ONLY" and forbids it on
  public surfaces; this is the results view every respondent lands on.
- **poll-view** — `.day-bar` had 183px of fixed chrome in a 390px viewport,
  leaving under half the row for the bar, so every day looked equally full.
- **global** — `overflow-wrap: break-word` on body, so long emails and share
  URLs stop forcing the whole page into horizontal scroll.
- **dashboard / admin-panel** — already had working phone rules; picked up the
  foundations work (hover guards, tap targets, safe-area on the fixed dialogs,
  `dvh` max-height so a long dialog's buttons stay reachable).

Also raised the `initial` bundle warning budget 700kB → 730kB in
`angular.json`. Baseline was 715.34kB against a 716.80kB ceiling; the
hover-guard media queries added ~3.6kB and crossed it.

## 4c. Device Matrix (check before merging any UI PR)

| Device | Width | Why it's on the list |
|---|---|---|
| iPhone SE | 375px | Narrowest phone still in real use; `phone-narrow` tier |
| iPhone 15 / 16 | 393px | The modal device, and Reese's class of phone |
| Pixel 8 | 412px | Android Chrome — different `touch-action` implementation |
| iPad mini portrait | 744px | **Touch device above the phone breakpoint** — still gets the desktop grid, so it's the one that proves the coarse-pointer `touch-action` repair |
| Desktop | 1280px | Drag-paint must still work with a mouse |

Emulated devtools do **not** reproduce `touch-action` faithfully. The grid rows
must be checked on real hardware.

## 5. Risks / Notes

- Phase 0 touches the exact interaction Phase 0-prototype flagged as the top
  cross-browser risk. It needs testing on real iOS Safari and Android Chrome —
  a desktop devtools emulator does **not** reproduce `touch-action` behavior
  faithfully.
- Long-press-to-paint (Option A) conflicts with iOS text-selection callout;
  needs `-webkit-touch-callout: none` on the grid.
- Phase 2 doubles the grid's presentation surface. Mitigated by keeping all
  selection logic in the existing component and swapping only the template
  region under the breakpoint.
- **`PHONE_MEDIA_QUERY` (component TS) and the `phone` mixin (SCSS) must stay
  in lockstep at 575.98px.** The layouts are swapped by `*ngIf`, so if the two
  drift the app renders a layout its own stylesheet isn't styling. There is no
  build-time check on this — a test asserting the constant's value would only
  restate it, not tie it to the SCSS.
- Drag-paint is now mouse/pen only. On a touch tablet the desktop grid is
  tap-to-toggle. Nobody asked for tablet drag-paint, but it is a capability
  that quietly went away.

## 7. Known Follow-Ups (not in this change)

- `$text-3xs` (11px) is still used on public surfaces in `styled-date`,
  `styled-select`, `user-menu`, `poll-view`, `form-results`, `poll-create` and
  one base rule in `overlap-heatmap` — against the rule stated in
  `_tokens.scss`. Left alone here because changing them alters desktop
  appearance, which is a design call rather than a mobile fix.
- `overlap-heatmap` puts `tabindex="0"` on every heat cell. A 7-day × 28-row
  poll is 196 tab stops before the rest of the page. Pre-existing, affects all
  viewports.
- `$breakpoint-xs: 400px` lives in `_responsive.scss` because the shared
  generated token scale bottoms out at 576px. It should be promoted upstream
  into `xomware-frontend/src/styles/_tokens.scss` via `sync-tokens.mjs`.

---

## 6. Open Questions for Dominick

1. ~~Option A / B / C for the grid?~~ **Answered: B, rebuild now.**
2. ~~Phase 0 as its own PR?~~ **Answered: no, skipped.**
3. Is there an issue on XomBoard for this yet, or should one be opened? The
   branch is `feat/mobile-overhaul` with no issue number, which departs from the
   `<type>/<issue-number>-<desc>` convention — rename once an issue exists.
