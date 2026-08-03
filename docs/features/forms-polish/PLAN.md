# Forms Polish — Pickers, Start Interval, Form Lifecycle, Nav

**Status:** Built — awaiting deploy (backend + infra must ship before the frontend)
**Repos touched:** `xomforms-frontend`, `xomforms-backend`, `xomforms-infrastructure`
**Base branch:** `master` (frontend currently on `feature/duration-start-range-scheduler`)

---

## Problem

Five asks, from creator feedback:

1. Time and calendar pickers are unstyled OS chrome — they look foreign next to the app's `--xf-*` input system.
2. Time selection allows arbitrary minutes (`12:07`). It should snap to sane increments.
3. The creator should choose the *frequency* of offered start times — on the hour, every 30, every 15. 15 is usually too granular.
4. There is no way to close or delete a form once created. Test junk accumulates with no cleanup path.
5. The header tabs look sloppy — four competing items in a row, with a raw email string sitting among them. Account identity belongs behind an avatar menu.

## Current State (verified)

| Area | Finding |
|---|---|
| Time inputs | `poll-create.component.html:83,87` — raw `<input type="time">`. Native popup, arbitrary minutes. |
| Date inputs | `poll-create.component.html:57,62` — raw `<input type="date">`; `:165,317` — `datetime-local`. Native calendar popup is OS chrome, not CSS-styleable. |
| Styled dropdown | `styled-select/` (`xf-select`) already exists — CVA-backed, groups, optional search. Used for duration + timezone only. |
| Granularity | Hard-locked to 15 in **two** places: `poll-create.component.ts:20` (`GRID_GRANULARITY_MINUTES`) and `xomforms-backend/lambdas/common/models.py:283`, which **overwrites** any client-sent `granularityMinutes` for the windowed shape. |
| Granularity constants | `constants.py:47` — `ALLOWED_GRANULARITY_MINUTES = (15, 30, 60)`. Already permits what we need. |
| Results path | `overlap.py:135-141` reads `granularityMinutes` and derives `slot_count = ceil(duration / granularity)`. **Already generic** — no change needed. |
| Delete/close | **No endpoint exists.** `lambdas/` has create/get/list only. `terraform/lambda.tf:35-57` defines exactly three polls routes. `closeAt` is write-once at create. |
| Header | `app.component.html:19-31` — four siblings in one row: My Forms link, New form button, raw `{{ user.email }}` span, Sign out button. No visual hierarchy between navigation and account. |
| User profile | `cognito.service.ts:135-139` maps only `userId` / `username` / `email`. No `name`, no `picture` — a profile menu needs both mapped from the ID token claims. |
| Public forms | No `discoverable` flag, no search endpoint, no search index. Discovery does not exist in any repo. |

**Consequence:** asks #3 and #4 cannot be delivered from the frontend alone.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| What the interval control changes | **Real grid granularity** | Only way to actually reduce responder painting granularity. Picker-options-only would leave a 15-min grid underneath — not what was asked. |
| Delete scope | **Delete + close, full stack** | Close kills a form without losing results; delete is for test junk. Both need the same new infra plumbing, so ship together. |
| Calendar styling | **Build `xf-date`** | The native popup cannot be styled. A custom month-grid popover matching `xf-select` is the only way to deliver "styling on calendar drop down picks". |
| HTTP method for new routes | **POST** (`/polls/delete`, `/polls/close`) | Matches existing `/polls/create`. Avoids DELETE-verb handling and preflight quirks in the shared `api-gateway-service` module. |
| "Find form" / public discovery | **Deferred** | Needs a `discoverable` flag, a search lambda, a search index, and moderation answers. Speculative surface until forms are actually meant to be found by strangers. Not built, not stubbed. |
| "Admin portal" | **Separate `/account` page** | Dropdown links to a real route rather than holding everything inline. Gives future settings a home. |

---

## Workstream A — Time pickers → `xf-select` (frontend only)

**Goal:** kill `<input type="time">`; no more `12:07`.

- Add `buildTimeOptions(step: number): SelectOption[]` to `grid.util.ts` — enumerates `0 → 1439` by `step`, labelled via existing `minutesToClockLabel` (`"7:00 PM"`).
- Replace `earliestStartTime` / `latestStartTime` inputs with `<xf-select [searchable]="true">`.
- **Change control value type from `'HH:MM'` string to `number` (minutes).** Removes the `timeToMinutes` / `timeStringToMinutes` round-trip in `poll-create.component.ts:410-416,535-538`; the value goes straight onto `earliestStartMinute` / `latestStartMinute`.
- Group options by part of day (`Morning` / `Afternoon` / `Evening` / `Late night`) using the existing `group` field so a 96-entry list stays navigable.

**Touches:** `grid.util.ts`, `poll-create.component.{ts,html}`, `poll-create.component.spec.ts`

## Workstream B — Start interval control (frontend + backend)

**Goal:** creator picks hour / 30 / 15; it drives the real grid.

### Frontend
- New form control `granularityMinutes`, **default 30** (per "every 15 is usually too granular").
- Options: `60 → "On the hour"`, `30 → "Every 30 minutes"`, `15 → "Every 15 minutes"`. Rendered as a segmented control (three options — a dropdown is overkill).
- Delete the `GRID_GRANULARITY_MINUTES` constant; read the control instead in `rebuildPreview()`.
- **Cascading re-snap** (the fiddly bit) — when granularity changes:
  - Rebuild the earliest/latest time option lists at the new step.
  - Snap current earliest/latest values to the nearest valid multiple (18:15 + hourly → 18:00).
  - Rebuild `durationOptions` to multiples of granularity, and snap the selected duration up to the next valid multiple.
  - All three must settle in one pass without retriggering `valueChanges` recursion — use `{ emitEvent: false }` on the programmatic `setValue` calls, then rebuild the preview once explicitly.
- Send `granularityMinutes` in `CreatePollRequest` (field already exists on the model at `poll.model.ts:72`).
- Hint text under the control explaining what responders will see.

### Backend (`xomforms-backend`)
- `models.py::_derive_window_from_start_range` (line ~283): stop hard-coding `DEFAULT_GRANULARITY_MINUTES`. Instead:
  - Use client `granularityMinutes` when supplied; **default to 15 when absent** (back-compat for the current shipped frontend).
  - Validate membership in `ALLOWED_GRANULARITY_MINUTES` (the existing `granularity_is_allowed` validator already covers this).
  - **New validation:** `earliestStartMinute`, `latestStartMinute`, and `eventDurationMinutes` must each be a multiple of `granularityMinutes`. Without this, `blocks_per_day = (dayEnd - dayStart) // granularity` truncates and the last event slot silently falls off the grid.
- Update the stale comment block at `models.py:138-144` which documents granularity as fixed.
- No change to `overlap.py`, `timezone.py`, or the results handlers — already granularity-generic.

**Risk:** `MAX_GRID_BLOCKS` — coarser granularity produces *fewer* blocks, so this relaxes rather than tightens the cap. No new failure mode.

## Workstream C — `xf-date` component (frontend only)

**Goal:** styled calendar popover matching `xf-select`.

- New `components/styled-date/` → `xf-date`, modelled directly on `StyledSelectComponent`:
  - `ControlValueAccessor`, value is a `YYYY-MM-DD` string (unchanged wire format).
  - Month grid popover, prev/next month nav, today marker, selected state.
  - `@Input() min` / `@Input() max` — disables out-of-range days. Wire `endDate.min = startDate` so an invalid range can't be picked.
  - Same outside-click and Escape `@HostListener` behaviour as `xf-select`.
  - Keyboard: arrows move by day/week, Enter selects, Escape closes.
- SCSS reuses the `--xf-*` tokens and the existing panel/shadow treatment so the two dropdowns read as one system.
- Apply to `startDate`, `endDate`.
- **`closeAt`** (`datetime-local`): compose `xf-date` + `xf-select` (time) side by side rather than building a third component. Both scheduler (`:165`) and Q&A (`:317`) close fields.
- Register in `app.module.ts` `declarations`.

## Workstream D — Close + delete forms (all three repos)

### Backend (`xomforms-backend`)
New dynamo helpers in `common/polls_dynamo.py`:
- `delete_poll(poll_id)`
- `set_poll_close_at(poll_id, iso_or_none)` — `update_item`; `None` removes the attribute (reopen).

New helper in `common/responses_dynamo.py`:
- `delete_responses_for_poll(poll_id)` — query by `pollId` PK, `batch_writer()` delete each `(pollId, respondentKey)`. **Responses must cascade** or they orphan in the table forever.

New lambdas:
- `lambdas/polls_delete/handler.py` — `get_caller_email` → `get_poll` → **403 unless `creatorEmail` matches** → cascade responses → delete poll.
- `lambdas/polls_close/handler.py` — same ownership check → `set_poll_close_at(now)`. Accepts `{"reopen": true}` to clear it.

Ownership enforcement is the security-critical piece here: `pollId` is a UUID but `polls_get` is public, so ids are discoverable by anyone holding a share link. Neither handler may act without the creator check.

### Infra (`xomforms-infrastructure`)
- Add two entries to `polls_lambdas` in `terraform/lambda.tf:35-57`:
  - `{ name = "delete", path_part = "delete", http_method = "POST", authorization = "COGNITO_USER_POOLS" }`
  - `{ name = "close",  path_part = "close",  http_method = "POST", authorization = "COGNITO_USER_POOLS" }`
- Everything else is derived — `api_gateway.tf:17-25` builds endpoints from the same local, and the lambda `for_each` at `lambda.tf:104` picks them up automatically.
- Confirm the lambda IAM role grants `dynamodb:DeleteItem` + `dynamodb:UpdateItem` on both tables.
- **Deploy infra before the frontend ships**, or the UI calls 404s.

### Frontend
- `PollsService`: `delete(pollId)`, `close(pollId)`, `reopen(pollId)`.
- `dashboard.component`:
  - Per-row overflow menu: **Close** / **Reopen** / **Delete**.
  - Checkbox multi-select on each row + a "select all" that honours the **currently filtered** rows, not the whole list.
  - Sticky bulk action bar when `selected.size > 0`: `"N selected"` → Close / Delete.
  - Confirm dialog for any delete. Bulk delete states the count and that responses are destroyed too.
  - Optimistic row removal with rollback + error toast on failure.
  - Bulk delete issues N parallel requests via `forkJoin`; partial failure re-adds only the rows that actually failed.

## Workstream E — Header + account menu (frontend only)

**Goal:** kill the four-in-a-row header; account identity moves behind an avatar menu.

### Nav structure
Final header: **brand** (left) · **My Forms** tab (centre-left) · **avatar menu** (right).

- **"New form" leaves the header.** The dashboard already carries it twice — a primary `btn-create` in `dash-header` (`dashboard.component.html:7-9`) and the empty-state CTA (`:30-32`). A single-tab nav plus an avatar reads clean; a lone "+ New form" button competing with one tab is what makes it look sloppy today. Reversible in one line if it feels like a step too far in use.
- **"Find form" is not built and not stubbed** — no disabled tab, no Coming soon badge, no dead route. Revisit as its own feature.
- With one nav item, style the tab as a real active-state tab (underline/pill via `routerLinkActive`) rather than a bare link.

### Avatar menu
- New `components/user-menu/` → `xf-user-menu`. Reuses the `xf-select` popover mechanics (outside-click + Escape `@HostListener`, same panel/shadow/token treatment) so all three dropdowns in the app behave identically.
- Trigger: circular avatar — `picture` claim when present, otherwise initials derived from name or email, on a `--xf-purple` fill.
- Panel contents: name (bold), email (muted), divider, **Account** → `/account`, **Sign out**.
- Keyboard: Enter/Space opens, arrows move between items, Escape closes and returns focus to the trigger. `aria-haspopup="menu"`, `role="menu"` / `role="menuitem"`.

### Profile data
- Extend `XomUser` (`cognito.service.ts:13-15`) with `name?: string` and `picture?: string`; map `claims['name']` and `claims['picture']` at `refreshUser()` (`:135-139`).
- **Verify before relying on it:** the shared `xomware_users` pool must actually map Google's `name`/`picture` onto the user attributes for the `cognito_client_xomforms` app client. If those claims aren't in the ID token, the menu falls back to initials + email and the avatar image is skipped. Check the pool's attribute mapping in `xomware-infrastructure` first — this is the one item in Workstream E that could need an infra change.
- Every field must degrade gracefully: name absent → show email only; picture absent → initials.

### `/account` page
- New `components/account/` at route `/account`, `canActivate: [authGuard]`.
- Day one: read-only profile card (avatar, name, email, member-since if available) + Sign out.
- **No settings persistence.** Saved defaults (default timezone, default granularity) need a users table that doesn't exist. Leave the section out entirely rather than shipping dead controls — see Open Question 4.
- If Workstream D lands first, this page is the natural home for a "Delete all my forms" danger zone reusing the bulk-delete path.

**Touches:** `app.component.{html,scss,ts}`, `cognito.service.ts`, new `user-menu/`, new `account/`, `app.module.ts`, `app-routing.module.ts`

---

## Sequencing

1. **Backend + infra** (Workstream B backend half, Workstream D backend/infra) — deploy first so the frontend has real endpoints.
2. **Workstreams A + C + E** (frontend, no backend dependency) — can land in parallel. E is fully independent of everything else; it's the cheapest visible win, so it can go first.
3. **Workstream B frontend half** — needs the deployed granularity change to be meaningful.
4. **Workstream D frontend** — needs the deployed endpoints.

## Testing

- **Frontend:** extend `poll-create.component.spec.ts` — granularity re-snap cascade (the highest-risk logic), time option generation, preview rebuild at each step. New `styled-date.component.spec.ts` — min/max clamping, month rollover, CVA round-trip. New dashboard specs — bulk selection honouring filters, optimistic rollback on partial failure. New `user-menu.component.spec.ts` — the three degradation paths (name+picture, name only, email only) and outside-click/Escape close.
- **Backend:** pytest for granularity acceptance/rejection, the new multiple-of-granularity alignment validation, ownership 403 on both new handlers, and response cascade on delete.
- Run `npm run test -- --watch=false --browsers=ChromeHeadless` and backend `./run_tests.sh`.

## Deviations From Plan (as built)

1. **`closeAt` is now two form controls, not one.** Split into `closeAtDate` + `closeAtTime`
   and recombined into a single ISO instant at submit. The close-time list is a fixed
   30-minute list, deliberately independent of the event's start interval — when a form
   stops accepting answers has nothing to do with its grid resolution.
2. **Close/reopen takes `closeAt` from the server echo, not a local clock.** The first cut
   stamped `new Date()` locally; `derivePollStatus` uses a strict `<`, so a just-now
   timestamp still read as "open" and the row didn't flip. The handlers echo the updated
   poll for exactly this reason.
3. **`snapMinutesToStep` / `snapDurationToStep` live in `grid.util.ts`**, not inline in the
   component, so the re-snap rules are unit-testable on their own.
4. **Duration rounds UP** onto the interval. Shrinking someone's event because they widened
   the interval is the worse surprise.
5. **No IAM or deploy-workflow change was needed.** `iam_lambda.tf:108-120` already grants
   DeleteItem/UpdateItem/BatchWriteItem on `xomforms*`, and `deploy-backend.yml` discovers
   lambdas via `ls lambdas/*/` with an underscore→hyphen fallback that maps `polls_delete` →
   `xomforms-polls-delete`, matching what Terraform creates.

## Known Follow-ups

- **Bundle budget:** initial bundle went 589.61 kB → 627.73 kB, crossing the 600 kB
  *warning* threshold (error threshold is 1 MB, so nothing fails). Growth is three real new
  components. `dashboard.component.scss` also crossed the 10 kB component-style warning;
  `poll-create.component.scss` was already over before this work. Thresholds were left
  untouched rather than raised to hide the growth — bump `angular.json:56-67` if the noise
  isn't wanted.
- **Backend tests need the repo venv** (`.venv/bin/python -m pytest`). The ambient `python3`
  on this machine is 3.9 and can't parse the `str | None` syntax the codebase uses;
  `run_tests.sh` also assumes a `pip` on PATH that isn't there.

## Open Questions

1. Default granularity — plan assumes **30**. Confirm.
2. Should existing polls be migratable to a new granularity (an edit path), or is this create-time only? Plan assumes **create-time only**.
3. Does "close" need to be reversible in the UI, or is one-way enough? Plan builds **reopen** since it's nearly free once `set_poll_close_at` exists.
4. `/account` has nothing to save until a users table exists. Is a settings surface (default timezone, default granularity) worth its own feature later, or should `/account` stay a profile card indefinitely?
5. Dropping "New form" from the header is my call, not yours — you said "maybe". Flag it if you want it kept.
6. Does the shared `xomware_users` pool actually put Google's `name`/`picture` in the ID token for this app client? If not, the avatar degrades to initials until an infra change lands.
