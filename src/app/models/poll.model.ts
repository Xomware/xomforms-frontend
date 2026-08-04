/**
 * Typed interfaces matching xomforms-backend's lambdas/common/models.py
 * Pydantic contracts exactly (CreatePollRequest, PollResponse). Dates are
 * ISO "YYYY-MM-DD" strings, timestamps are ISO 8601 UTC strings -- the
 * wire format Pydantic serializes to, not native Date objects.
 */

/**
 * A poll is either the original scheduler ("scheduler", the default when
 * absent) or a Q&A form ("qa"). This mirrors xomforms-backend's additive
 * `formType` -- a scheduler poll is byte-for-byte the pre-form-builder shape.
 */
export type FormType = 'scheduler' | 'qa';

/** The aggregatable field types shipped in Phase 1 (all tally to CSS bars). */
export type FieldType = 'single_choice' | 'multi_choice' | 'dropdown' | 'scale';

export interface FieldOption {
  optionId: string;
  label: string;
}

interface BaseFormField {
  fieldId: string;
  label: string;
  required?: boolean;
}

export interface ChoiceFormField extends BaseFormField {
  type: 'single_choice' | 'multi_choice' | 'dropdown';
  options: FieldOption[];
}

export interface ScaleFormField extends BaseFormField {
  type: 'scale';
  min: number;
  max: number;
  minLabel?: string | null;
  maxLabel?: string | null;
}

export type FormField = ChoiceFormField | ScaleFormField;

export function isChoiceField(field: FormField): field is ChoiceFormField {
  return field.type === 'single_choice' || field.type === 'multi_choice' || field.type === 'dropdown';
}

export function isScaleField(field: FormField): field is ScaleFormField {
  return field.type === 'scale';
}

/**
 * Who may see a form's results. Supersedes the older
 * `showResultsToRespondents` boolean, which the backend keeps in sync.
 *   hidden          -- creator only
 *   after_response  -- respondents see results once they've submitted
 *   always          -- anyone with the link
 */
export type ResultsVisibility = 'hidden' | 'after_response' | 'always';

/** One invited recipient plus the outcome of the send. */
export interface FormInvite {
  email: string;
  name?: string | null;
  sentAt?: string;
  status: 'sent' | 'failed';
  error?: string;
}

export interface CreatePollRequest {
  title: string;
  description?: string | null;
  /** Absent => "scheduler" (back-compat). */
  formType?: FormType;
  /** Typed field list for a Q&A form. Omit for a scheduler poll. */
  fields?: FormField[];
  // Scheduler scalars -- required for a scheduler poll, omitted for a Q&A form.
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  /**
   * Duration + start-range model. The frontend sends the START range
   * (earliest/latest allowed start) + eventDurationMinutes; the backend DERIVES
   * and persists the paint window (dayStart = earliest, dayEnd = latest +
   * duration, granularity = 15). dayEnd may exceed 1440 (overnight).
   */
  earliestStartMinute?: number; // minutes since local midnight
  latestStartMinute?: number; // minutes since local midnight
  dayStartMinute?: number; // minutes since local midnight (legacy / derived echo)
  dayEndMinute?: number; // exclusive; may exceed 1440 for overnight
  granularityMinutes?: number; // fixed at 15 for windowed polls; legacy: 15|30|60
  timezone?: string; // IANA tz name, e.g. "America/New_York"
  guestAllowed?: boolean; // default false
  showResultsToRespondents?: boolean; // legacy; kept in sync by the backend
  resultsVisibility?: ResultsVisibility; // default after_response
  allowResponseEdits?: boolean; // default true
  /** Which quick time filters the respondent grid offers. Empty = defaults. */
  quickFilters?: string[];
  /**
   * Free-text note from the creator telling respondents HOW to answer.
   * Distinct from `description`, which describes the event itself.
   */
  instructions?: string | null;
  closeAt?: string | null; // ISO 8601 UTC datetime
  /**
   * Event length in minutes (15-min steps, 15..360). Required for the windowed
   * scheduler shape; drives both the derived grid end and the results "best
   * contiguous start window".
   */
  eventDurationMinutes?: number | null;
}

export interface Poll {
  pollId: string;
  creatorEmail: string;
  title: string;
  description?: string | null;
  /** Absent on polls created before the form-builder => treat as "scheduler". */
  formType?: FormType;
  fields?: FormField[] | null;
  startDate?: string;
  endDate?: string;
  /** Creator's start-range inputs (may be absent on legacy polls). */
  earliestStartMinute?: number;
  latestStartMinute?: number;
  dayStartMinute?: number;
  dayEndMinute?: number;
  granularityMinutes?: number;
  timezone?: string;
  guestAllowed: boolean;
  showResultsToRespondents: boolean;
  /** Absent on polls created before the setting existed -- see effectiveVisibility. */
  resultsVisibility?: ResultsVisibility;
  allowResponseEdits?: boolean;
  quickFilters?: string[] | null;
  instructions?: string | null;
  invites?: FormInvite[] | null;
  closeAt?: string | null;
  /** Event length in minutes; may be absent on polls created before this field. */
  eventDurationMinutes?: number | null;
  createdAt: string;
}

/** A qa poll is one with formType 'qa' or (defensively) a non-empty fields array. */
export function isQaPoll(poll: Pick<Poll, 'formType' | 'fields'>): boolean {
  return poll.formType === 'qa' || !!(poll.fields && poll.fields.length > 0);
}

export interface PollListResponse {
  polls: Poll[];
}

/**
 * Lifecycle status shown on the "My Forms" dashboard. The backend has no
 * first-class `status` attribute yet (see xomforms-v2 BRAINSTORM — draft/
 * open/closed/finalized is a later, additive backend change), so for the
 * Foundation we DERIVE open/closed purely from `closeAt`:
 *   - closed  → `closeAt` is set and already in the past
 *   - open    → otherwise (no close time, or close time still in the future)
 * When the backend gains a real status field, swap this for `poll.status`.
 */
export type PollStatus = 'open' | 'closed';

export function derivePollStatus(poll: Pick<Poll, 'closeAt'>, now: number = Date.now()): PollStatus {
  if (poll.closeAt && new Date(poll.closeAt).getTime() < now) {
    return 'closed';
  }
  return 'open';
}

/**
 * One candidate availability block in a poll's grid. Matches
 * lambdas/common/timezone.py::generate_grid()'s output shape exactly.
 * blockId is the stable "YYYY-MM-DDTHH:MM" wall-clock label in the poll's
 * OWN timezone (not the viewer's) -- the frontend re-renders it in the
 * viewer's local tz using utcInstant, per the plan's DST-safety design.
 */
export interface GridBlock {
  blockId: string;
  utcInstant: string; // ISO 8601 UTC instant
}

/**
 * A poll's effective results visibility. Mirrors the backend's read-time shim
 * for polls created before the setting existed: the old boolean maps to
 * always/hidden. The backend is the enforcement point -- this only decides
 * what the UI offers.
 */
export function effectiveVisibility(
  poll: Pick<Poll, 'resultsVisibility' | 'showResultsToRespondents'>,
): ResultsVisibility {
  if (
    poll.resultsVisibility === 'hidden' ||
    poll.resultsVisibility === 'after_response' ||
    poll.resultsVisibility === 'always'
  ) {
    return poll.resultsVisibility;
  }
  return poll.showResultsToRespondents ? 'always' : 'hidden';
}

/** Whether respondents may change their answer. Absent means yes (see backend). */
export function allowsResponseEdits(poll: Pick<Poll, 'allowResponseEdits'>): boolean {
  return poll.allowResponseEdits !== false;
}

/** A form the caller has responded to, as returned by GET /responses/mine. */
export interface RespondedForm {
  pollId: string;
  title?: string;
  formType?: FormType;
  creatorEmail?: string;
  closeAt?: string | null;
  timezone?: string;
  createdAt?: string;
  allowResponseEdits: boolean;
  submittedAt?: string;
  displayName?: string;
  blocks?: string[];
  answers?: Record<string, unknown>;
}

export interface RespondedFormsResponse {
  responses: RespondedForm[];
}

/** Result of linking this browser's guest responses to the signed-in account. */
export interface ClaimResult {
  claimed: string[];
  skippedExisting: string[];
  skippedStale: string[];
  windowHours: number;
}
