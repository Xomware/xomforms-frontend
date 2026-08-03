# Epic — Distribution & Participation

**Status:** Draft — two blocking decisions before this is Ready
**Repos:** `xomforms-frontend`, `xomforms-backend`, `xomforms-infrastructure`
**Base branch:** `master`

---

## The Ask

1. Creator can enter a list of emails and send invites asking people to fill the form out.
2. A form has its own distinct URL (the create page used to stay on `/forms/new`).
3. Link, invite list, and admin settings live in their own **Admin tab, creator-only**.
4. Respondents get their own tabs: **their response**, and **results** — hidden/blurred until they complete the form.
5. Respondents can **edit their response**, if the creator allows it in settings.
6. **My Forms** lists forms you *created* **and** forms you *filled out* (the latter read-only).
7. A signed-out visitor hitting that gets a **sign in/up modal**.
8. On sign-up, **any responses from that browser session get tied to the new account**.

Item 2 already shipped in `fix/dark-mode-nav` — creating a form now does `replaceState('/forms/<id>')`. The rest is this epic.

---

## Two Blocking Discoveries

### A. Responses auto-delete when a form closes

`xomforms-responses` has TTL enabled on the `closeAt` attribute (`dynamodb.tf:82-85`), and `responses_dynamo` denormalizes the poll's `closeAt` onto every response row at submit time. **DynamoDB deletes those rows once that timestamp passes.**

This was a sensible cleanup rule when responses were write-only. It is directly incompatible with asks 4, 5, and 6:

- "Forms you filled out" silently empties as forms close — your history rots.
- "Edit your response" has nothing to edit.
- A creator reopening a closed form finds the responses gone, not merely hidden.

There is no way to build participation history on top of a table that garbage-collects it. **This must be resolved first**, and it needs your call (see Decisions).

Note the blast radius is narrower than it looks: only forms created *with* a `closeAt` ever set a TTL, and `polls_close` sets `closeAt` on the **poll**, not retroactively on existing response rows. So already-submitted responses to forms you closed via the new button are safe. It's forms created with a scheduled close time that are at risk.

### B. SES is provisioned but almost certainly still in sandbox

`ses.tf` is complete and applied — verified identity, DKIM, MAIL FROM, SPF, DMARC, a configuration set, and both SSM parameters. `form_invite.html` / `.txt` are written with a documented placeholder contract.

Missing:
- No send Lambda, and no `ses:SendEmail` in `iam_lambda.tf` (grep returns nothing).
- **SES production access.** In the sandbox an account may only send to *verified* addresses. Inviting arbitrary people is the entire point of ask 1, so this needs an AWS support request, which is a human step with a turnaround (often ~24h) that I cannot do for you.

Everything else in this epic can ship without it; invites simply won't reach unverified recipients until access is granted.

---

## Design

### Data model changes

**`xomforms-responses` — new GSI `respondentKey-index`** (PK `respondentKey`, SK `pollId`). This is what makes "forms you filled out" a query rather than a full-table scan. Additive; no rewrite of existing rows.

**`xomforms-polls` — three new attributes:**
| Attribute | Type | Meaning |
|---|---|---|
| `allowResponseEdits` | bool | Respondent may change their answer after submitting. Default **true**. |
| `resultsVisibility` | enum | `hidden` / `after_response` / `always`. Supersedes `showResultsToRespondents`. |
| `invites` | list | Recipient records: `{email, sentAt, status}`. |

`resultsVisibility` replaces today's boolean. Migration is a read-time shim, not a backfill: absent → `always` if `showResultsToRespondents` is true, else `hidden`. Both are written on create so old clients keep working.

### Backend — new lambdas

| Lambda | Route | Auth | Purpose |
|---|---|---|---|
| `responses_mine` | `GET /responses/mine` | Cognito | Forms the caller has responded to, via the new GSI |
| `responses_get_mine` | `GET /responses/get-mine` | Cognito + guest | The caller's own response to one form, for prefill/edit |
| `invites_send` | `POST /invites/send` | Cognito, creator only | Render templates, `SendEmail` per recipient, record status |
| `invites_list` | `GET /invites/list` | Cognito, creator only | Recipients + delivery status |
| `responses_claim` | `POST /responses/claim` | Cognito | Re-key `guest#<uuid>` rows to the caller's email |
| `polls_update` | `POST /polls/update` | Cognito, creator only | Edit settings (`allowResponseEdits`, `resultsVisibility`, title/description) |

New shared helper `lambdas/common/email_helpers.py`: loads the templates, HTML-escapes every user-supplied value (the README is explicit about this and it's the injection surface), substitutes placeholders, sends via SES with the configuration set from SSM.

**Results gating is enforced server-side, not just in the UI.** `results_get_public` must refuse when `resultsVisibility` is `hidden`, and when it's `after_response` must confirm the caller actually has a response row first. A blurred `<div>` is a CSS trick — the JSON is one devtools tab away, and for a poll about people's availability that's a real leak.

### Guest → account claiming

`responses.service.ts:14` already persists a guest id in `localStorage` under `xomforms_guest_id`, so the mechanism exists. On sign-in the client posts that id; `responses_claim` finds its rows and rewrites them to the caller's email.

Three things make this sharper than it sounds:

- **Re-keying is a delete + write**, since `respondentKey` is the sort key and DynamoDB keys are immutable. Must be idempotent — a retried claim can't duplicate rows.
- **Collision:** if the user already responded to the same form under their email, claiming would clobber it. The authed response should win, and the guest row is discarded.
- **Shared browser.** A guest id is a browser, not a person. If two people answer from one laptop and the second signs up, they'd claim the first person's response. Mitigation: only claim rows submitted within a bounded recent window, and tell the user what's being linked rather than doing it silently.

### Frontend

**Tabs on a form**, driven by role:
- Creator sees **Results · Admin**. Admin holds the share link, the invite composer + delivery list, and settings (edit toggle, results visibility, close/reopen).
- Respondent sees **Your response · Results**, with Results gated per `resultsVisibility`.

**My Forms** gains a Created / Responded split. Responded rows are read-only — no bulk delete, no close.

**Sign-in modal** for signed-out visitors, reusing the existing hosted-UI redirect rather than a bespoke form. After the redirect resolves, fire the claim.

New components: `form-tabs`, `admin-panel`, `invite-composer`, `my-response`, `auth-modal`, `results-gate`.

---

## Sequencing

1. **TTL resolution** (below) — nothing durable can be built until history stops evaporating.
2. **Infra:** responses GSI, `ses:SendEmail` IAM, six new routes.
3. **Backend:** settings attributes + `polls_update`, then `responses_mine` / `get-mine`, then claim, then invites.
4. **Frontend:** tabs + admin panel → my-response + results gate → My Forms split → auth modal + claim.

Infra applies first in every case, as before.

## Testing

Backend: GSI query correctness, results-gating refusals (the security-critical part), claim idempotency + collision + window, template escaping with hostile titles. Frontend: tab role routing, gate states, read-only responded rows, claim-after-signin.

---

## Decisions I Need

1. **The response TTL.** Options: (a) **drop TTL entirely** — history is the product now, cleanup becomes a later problem; (b) keep it but re-point at a `retentionUntil` set far past close (e.g. +1 year); (c) keep today's behaviour and accept that participation history disappears when forms close. My recommendation is **(a)**: you cannot offer "forms you filled out" on storage that deletes itself, and the volume here is trivial.
2. **SES production access.** Do you want me to draft the support request for you to file? Until it's granted, invites only deliver to verified addresses — everything else still ships.
3. **`resultsVisibility` default for new forms.** I'd default to **`after_response`**, which matches your "blur until they complete" instinct and is the better default for availability polls (seeing others' answers first biases yours).
4. **Response edits default.** I'd default `allowResponseEdits` to **true** — people mistype availability constantly, and the creator can switch it off.
5. **Claim window.** I'd link only responses from the last **24 hours** on that browser, and show the user what's being linked before doing it. Shared-laptop cases are otherwise a silent data-attribution bug.
