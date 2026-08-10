# Flow Overhaul — Create + Respond

**Status:** Option A implemented — see §6
**Trigger:** "the form for new schedule is weird. weird spacing. not easy for
user to fill out. they still have to go day to day and click boxes. overall
flow isn't super easy on the app web and mobile. it should aim to make it
better than google forms"

---

## 1. Diagnosis — Create Form

`poll-create.component.html`, scheduler mode. Fourteen controls in one flat
column:

| # | Control | Required? |
|---|---|---|
| 1 | Title | **yes** |
| 2 | Description | no |
| 3 | Location | no |
| 4 | Instructions for respondents | no |
| 5 | Start date | **yes** |
| 6 | End date | **yes** |
| 7 | Offer start times (15/30/60 segmented) | has default |
| 8 | Event length | has default |
| 9 | Earliest start | has default |
| 10 | Latest start | has default |
| 11 | Event timezone | has default |
| 12 | Anyone with link can respond | default on |
| 13 | Show results to respondents | default |
| 14 | Close responses at (date + time) | no |

**Three optional text fields sit between the title and the first date.** A
creator whose only goal is "find a time next week" scrolls past a description
box, a location picker, and an instructions box before reaching anything that
determines the poll.

### The spacing problem, specifically

```scss
form          { gap: 18px; }   // between every top-level control
.time-config  { gap: 16px; }   // between fields INSIDE the grouped fieldset
.field        { gap:  6px; }   // label -> input
```

18px vs 16px. The space between two unrelated sections is within 2px of the
space between two fields of the same section, so **no grouping is legible**.
The `time-config` fieldset's border is doing all the grouping work on its own,
and everything outside it is an undifferentiated stack. This is what reads as
"weird spacing" — it isn't that any one gap is wrong, it's that they're all
the same, so the form has no shape.

A form this long needs at least three tiers: field (6px), field-group (16px),
section (36-40px + a heading).

### Required-vs-optional is invisible

Optional fields are marked only by a small "(optional)" span next to the label.
They occupy identical width, weight, and vertical space as required ones. On a
14-control form, that means the creator reads all 14 to find the 3 that matter.

---

## 2. Diagnosis — Respond Flow

This is the harder problem, and the mobile rebuild did not solve it — it fixed
*scrolling*, not *effort*.

Cost of answering a typical poll (5 days, 4-hour window, 30-min slots = 40
blocks):

| Surface | Interaction | Taps/clicks |
|---|---|---|
| Desktop | drag-paint | ~5 drags |
| Phone (current) | tap each block, day by day | **~40 taps + 4 day-switches** |

The quick filters ("Weekdays", "After 5 PM") already collapse this to 1-2 taps,
**but they're rendered as small pills in a toolbar above the grid** — they read
as a secondary utility, not as the primary way to answer. Most people will
never use them.

The deeper issue: a grid asks "mark every slot you are free," which is an
open-ended data-entry task. Google Forms asks closed questions. Doodle beat
everyone in this category by asking a closed question too — "which of these
specific times work?"

---

## 3. Options

### Option A — Fix the two flows in place
Restructure the create form into sections with a real spacing scale and
progressive disclosure (optional fields behind "Add details"). On the respond
side, promote the presets to the primary answer path and add **range-tap** (tap
a start, tap an end, fill between) plus **"apply this day to..."**.

- Keeps one mental model and the whole data model untouched.
- Answering drops from ~40 taps to ~4-8.
- Does not change what the product *is*. Still a grid at heart.
- Smallest, safest, shippable in one pass.

### Option B — Add a candidate-times model (Doodle-style)
Creator proposes a handful of specific slots ("Tue 7pm, Wed 7pm, Sat 2pm").
Respondents answer yes / no / maybe on ~5 options. The grid becomes the
"advanced" path for when the creator genuinely wants to find any overlap in a
week.

- Answering becomes ~5 taps, identical on phone and desktop. No grid, no
  panning, no day-switching.
- Creating becomes "pick 5 times" instead of configuring 8 parameters.
- This is the actual "better than Google Forms" move — it's a closed question.
- Needs backend work: a new poll type, new response shape, new results view.
- Two poll types to maintain forever.

### Option C — Candidate times as the default, grid as opt-in
B, plus: the create flow leads with "propose specific times," and "let people
paint a whole range instead" is a secondary choice. The grid stays for power
users but stops being the thing every new creator meets first.

- Best end state for the stated goal.
- Largest build. Needs the backend contract designed before any UI.

---

## 4. Recommendation

**A now, then C.**

A is independently worth doing — the create form's spacing and the buried
presets are defects under any model, and range-tap pays off even inside the
candidate-times world. It is also the only option that improves the Charlotte
league's experience on the current backend.

C is the real answer to "better than Google Forms," but it is a product
decision with a backend contract attached, and it should not be started as a
CSS pass.

---

## 6. Decision + What Shipped

**Chosen: Option A**, scheduler create form only. Candidate-times (C) deferred
as a separate product decision with a backend contract attached.

### Create form

Three sections with a real spacing scale, replacing the flat 18px column:

```
6px   label -> input      (.field)
16px  field -> field      (.form-section)
40px  section -> section  (28px padding + rule + heading)
```

- **What is it?** — Title, then a `+ Description, location, and instructions`
  disclosure holding the three optional text fields that used to sit between
  the title and the first date.
- **When could it happen?** — dates, interval, length, start range, timezone.
  The `time-config` fieldset lost its `<legend>`; the section heading does that
  job now, so the panel is no longer a second competing group boundary.
- **Responses** — visibility checkboxes and the close date.

Net effect: a creator who only wants a date range meets 3 controls instead of
14, and the two that matter are above the fold.

### Respond flow

- **Quick answers** lead the component on every viewport: "Weekday evenings",
  "Weekends", "I'm free anytime". Same day/time filter primitives that were
  already there, but phrased as an answer to a question and given the weight of
  the primary path instead of being pills in a toolbar. The evenings option
  hides itself if the creator offers no evening filter.
- **Range tap** on phones: tap a start, tap an end, everything between fills.
  Order-independent; tapping a picked time un-picks it and cancels a pending
  range; changing day drops the anchor.
- **Copy to every day** matches the day on screen to all others by
  time-of-day — the single biggest saving, since most weeks are the same shape.

Cost of answering a 5-day / 4-hour / 30-min poll on a phone:

| | Before | After |
|---|---|---|
| Typical ("weekday evenings") | ~40 taps | **1** |
| Custom, same each day | ~40 taps | **3** (start, end, copy) |
| Fully bespoke per day | ~40 taps | ~10 (2 per day) |

Verification: prod build clean, stylelint clean, 207/207 tests (21 added).

One bug caught while building: "I'm free anytime" originally used `selectAll()`,
which writes into the hand-painted set that filters deliberately never take
back — so tapping "Weekends" afterwards left everything selected and read as a
dead control. It's now expressed as "every day, no time restriction" through the
filter primitives, so it composes and reverses correctly. Regression test added.

## 5. Open Questions

1. A, B, or C?
2. For the create form — is the Q&A ("Blank form") builder in scope too, or
   scheduler only? It shares `.field-row` / `.field` and the same flat rhythm.
3. Does the backend already model anything like a candidate-slot poll, or is
   that greenfield? (Affects B/C sizing — needs a look at `xomforms-backend`.)
