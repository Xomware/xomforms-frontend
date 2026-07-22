/**
 * Typed interfaces matching xomforms-backend's lambdas/common/models.py
 * Pydantic contracts exactly (CreatePollRequest, PollResponse). Dates are
 * ISO "YYYY-MM-DD" strings, timestamps are ISO 8601 UTC strings -- the
 * wire format Pydantic serializes to, not native Date objects.
 */

export interface CreatePollRequest {
  title: string;
  description?: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dayStartMinute: number; // minutes since local midnight
  dayEndMinute: number; // exclusive
  granularityMinutes: number; // one of 15 | 30 | 60
  timezone: string; // IANA tz name, e.g. "America/New_York"
  guestAllowed?: boolean; // default false
  showResultsToRespondents?: boolean; // default false
  closeAt?: string | null; // ISO 8601 UTC datetime
}

export interface Poll {
  pollId: string;
  creatorEmail: string;
  title: string;
  description?: string | null;
  startDate: string;
  endDate: string;
  dayStartMinute: number;
  dayEndMinute: number;
  granularityMinutes: number;
  timezone: string;
  guestAllowed: boolean;
  showResultsToRespondents: boolean;
  closeAt?: string | null;
  createdAt: string;
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
