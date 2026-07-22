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
  dayEndMinute: number; // exclusive
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
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;

    for (let minute = config.dayStartMinute; minute < config.dayEndMinute; minute += config.granularityMinutes) {
      const h = Math.floor(minute / 60);
      const m = minute % 60;
      const blockId = `${dateStr}T${pad2(h)}:${pad2(m)}`;
      const utcInstant = zonedWallTimeToUtc(year, month, day, h, m, config.timezone).toISOString();
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
