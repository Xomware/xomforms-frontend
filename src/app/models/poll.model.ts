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
  dayStartMinute?: number; // minutes since local midnight
  dayEndMinute?: number; // exclusive
  granularityMinutes?: number; // one of 15 | 30 | 60
  timezone?: string; // IANA tz name, e.g. "America/New_York"
  guestAllowed?: boolean; // default false
  showResultsToRespondents?: boolean; // default false
  closeAt?: string | null; // ISO 8601 UTC datetime
  /**
   * How long the scheduled event actually runs, in minutes. Omit for a
   * single-slot event -- the backend defaults it to granularityMinutes.
   * Drives the results "best contiguous start window" only.
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
  dayStartMinute?: number;
  dayEndMinute?: number;
  granularityMinutes?: number;
  timezone?: string;
  guestAllowed: boolean;
  showResultsToRespondents: boolean;
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
