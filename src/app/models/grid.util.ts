import { GridBlock } from './poll.model';

/**
 * Client-side mirror of xomforms-backend's lambdas/common/timezone.py::
 * generate_grid(). polls_get returns raw poll config only (no
 * pre-computed grid), so the frontend independently regenerates the same
 * block list -- blockId is a stable "YYYY-MM-DDTHH:MM" wall-clock label
 * in the POLL's own timezone (not the viewer's), matching the backend
 * exactly so submitted blockIds validate against the backend's grid.
 *
 * Correctness invariant carried over from the backend (the plan's #1
 * risk): every block's wall-clock time is localized INDEPENDENTLY against
 * the poll's IANA timezone -- never derived by adding a duration to a
 * running UTC instant. That's what keeps blocks correct across a DST
 * transition inside the poll's date range.
 */

export interface PollGridConfig {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  dayStartMinute: number;
  dayEndMinute: number; // exclusive; MAY exceed 1440 for an overnight window
  granularityMinutes: number;
  timezone: string; // IANA tz name
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Converts a wall-clock date/time in an arbitrary IANA timezone to its
 * UTC instant, using the standard Intl.DateTimeFormat offset-probe
 * technique (no date-tz library dependency). Accurate across DST
 * transitions because the offset is computed fresh for each instant.
 */
function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  // Treat the wall-clock values as if they were UTC to get a stable epoch
  // anchor, then measure how far the target timezone's rendering of that
  // instant differs from UTC's rendering of it -- that difference IS the
  // timezone's offset at (approximately) that instant.
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const utcRendered = new Date(asIfUtc).toLocaleString('en-US', { timeZone: 'UTC' });
  const tzRendered = new Date(asIfUtc).toLocaleString('en-US', { timeZone });
  const offsetMs = new Date(utcRendered).getTime() - new Date(tzRendered).getTime();
  return new Date(asIfUtc + offsetMs);
}

/** Enumerate every candidate block for a poll config, chronologically ordered. */
export function generateGrid(config: PollGridConfig): GridBlock[] {
  const blocks: GridBlock[] = [];

  const start = new Date(`${config.startDate}T00:00:00`);
  const end = new Date(`${config.endDate}T00:00:00`);

  for (
    let current = new Date(start);
    current.getTime() <= end.getTime();
    current.setDate(current.getDate() + 1)
  ) {
    const year = current.getFullYear();
    const month = current.getMonth() + 1;
    const day = current.getDate();

    for (let minute = config.dayStartMinute; minute < config.dayEndMinute; minute += config.granularityMinutes) {
      // Overnight support: a minute offset >= 1440 belongs to the NEXT
      // calendar day. Rolling the date via a Date constructor handles
      // month/year rollover, and each block is still localized independently
      // (DST-safe) -- mirrors the backend's generate_grid exactly so blockIds
      // match. e.g. 22:00 + 3h yields blocks through <next-date>T00:45.
      const dayOffset = Math.floor(minute / 1440);
      const dayMinute = minute % 1440;
      const h = Math.floor(dayMinute / 60);
      const m = dayMinute % 60;

      const blockDate = new Date(year, month - 1, day + dayOffset);
      const by = blockDate.getFullYear();
      const bm = blockDate.getMonth() + 1;
      const bd = blockDate.getDate();
      const dateStr = `${by}-${pad2(bm)}-${pad2(bd)}`;

      const blockId = `${dateStr}T${pad2(h)}:${pad2(m)}`;
      const utcInstant = zonedWallTimeToUtc(by, bm, bd, h, m, config.timezone).toISOString();
      blocks.push({ blockId, utcInstant });
    }
  }

  blocks.sort((a, b) => a.utcInstant.localeCompare(b.utcInstant));
  return blocks;
}

/** The viewer's IANA timezone, for rendering blocks in local time. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Formats a UTC instant string for display in the viewer's local timezone. */
export function formatLocal(utcInstant: string, timeZone: string = viewerTimeZone()): string {
  return new Date(utcInstant).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Just the clock time, e.g. "7:00 PM", in the viewer's local timezone. */
export function formatTime(utcInstant: string, timeZone: string = viewerTimeZone()): string {
  return new Date(utcInstant).toLocaleString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The full weekday + date, e.g. "Saturday, Aug 1", in the viewer's local timezone. */
export function formatDayLong(utcInstant: string, timeZone: string = viewerTimeZone()): string {
  return new Date(utcInstant).toLocaleString('en-US', {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Human-friendly event length, e.g. 60 -> "1 hour", 300 -> "5 hours",
 * 90 -> "1.5 hours", 30 -> "30 minutes". Used for the results "event length"
 * line so the creator can see the window they're actually scheduling for.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = minutes / 60;
  const rounded = Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10;
  return `${rounded} hour${rounded === 1 ? '' : 's'}`;
}

/**
 * "HH:MM" (24h, e.g. an <input type=time> value) -> minutes since midnight.
 * Returns null for a blank/malformed value.
 */
export function timeStringToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Minutes-since-midnight -> a friendly 12-hour clock label, e.g. 1320 ->
 * "10:00 PM". Wraps modulo 24h so an overnight end time (e.g. 1500 = 25:00)
 * renders as its next-day wall clock ("1:00 AM").
 */
export function minutesToClockLabel(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  let h = Math.floor(total / 60);
  const m = total % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Snap a minutes-since-midnight value onto the nearest valid slot for a given
 * start interval, clamped so the result is always a real time of day. Used when
 * the creator changes the interval and an already-picked time (say 18:15) no
 * longer lands on the grid (hourly -> 18:00).
 */
export function snapMinutesToStep(minutes: number, step: number): number {
  const snapped = Math.round(minutes / step) * step;
  const maxStart = Math.floor(1439 / step) * step;
  return Math.min(Math.max(snapped, 0), maxStart);
}

/**
 * Snap an event length onto the start interval. Rounds UP rather than to the
 * nearest -- shrinking someone's event because they widened the interval is a
 * worse surprise than lengthening it. Clamped to the backend's accepted range
 * (MIN_EVENT_DURATION_MINUTES..MAX_EVENT_DURATION_MINUTES = 15..360).
 */
export function snapDurationToStep(minutes: number, step: number): number {
  const snapped = Math.ceil(minutes / step) * step;
  const maxDuration = Math.floor(360 / step) * step;
  return Math.min(Math.max(snapped, step), maxDuration);
}

export interface EndTimeSummary {
  /** The end-time clock label, e.g. "1:00 AM". */
  label: string;
  /** True when start + duration crosses midnight (end lands on the next day). */
  nextDay: boolean;
}

/**
 * Given a start time (minutes since midnight) and an event duration, compute
 * the end-time label and whether it crosses into the next day. Used for the
 * create-form "Latest start … ends …" warning and the results end-time label.
 */
export function eventEndSummary(startMinutes: number, durationMinutes: number): EndTimeSummary {
  const end = startMinutes + durationMinutes;
  return { label: minutesToClockLabel(end), nextDay: end >= 1440 };
}

/**
 * Plain-language explanation of what a respondent is actually picking.
 *
 * The grid shows START TIMES, not the hours the event covers -- painting 7 PM
 * on a 3-hour event means 7:00-10:00. That is not obvious from a grid of
 * times, and getting it wrong means someone marks every hour they are free
 * rather than the times they could begin.
 *
 * Returns null when the poll predates the start-range shape and there is
 * nothing reliable to say.
 */
export function startRangeSummary(poll: {
  eventDurationMinutes?: number | null;
  earliestStartMinute?: number;
  latestStartMinute?: number;
}): string | null {
  const duration = poll.eventDurationMinutes;
  const earliest = poll.earliestStartMinute;
  const latest = poll.latestStartMinute;
  if (!duration || earliest == null || latest == null) return null;

  const example = eventEndSummary(earliest, duration);
  const range =
    earliest === latest
      ? `Starts at ${minutesToClockLabel(earliest)}.`
      : `Start times run from ${minutesToClockLabel(earliest)} to ${minutesToClockLabel(latest)}.`;

  return (
    `Pick the times you could START. This event runs ${formatDuration(duration)}, ` +
    `so choosing ${minutesToClockLabel(earliest)} means ${minutesToClockLabel(earliest)}\u2013` +
    `${example.label}${example.nextDay ? ' the next day' : ''}. ${range}`
  );
}
