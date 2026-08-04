import { OverlapResult } from './response.model';

/** One day's best headcount, for the per-day breakdown bars. */
export interface DayTurnout {
  date: string;
  label: string;
  best: number;
}

/**
 * Derived stats for the Analytics tab.
 *
 * Shared by the creator's form page and the respondent's view rather than
 * computed in each: they show the same numbers, and two copies would drift the
 * moment one gained a metric.
 *
 * Every function tolerates a null result and zero respondents, because both
 * views render before the first poll response arrives.
 */
export function respondentCount(result: OverlapResult | null): number {
  return result?.totalRespondents ?? 0;
}

export function hasAnalytics(result: OverlapResult | null): boolean {
  return respondentCount(result) > 0 && (result?.blocks?.length ?? 0) > 0;
}

/** Start times where every single respondent is free. */
export function unanimousCount(result: OverlapResult | null): number {
  const total = respondentCount(result);
  if (!total || !result) return 0;
  return result.blocks.filter((b) => b.count === total).length;
}

/** Share of offered start times nobody at all can make. */
export function deadSlotPercent(result: OverlapResult | null): number {
  const blocks = result?.blocks ?? [];
  if (!blocks.length) return 0;
  return Math.round((blocks.filter((b) => b.count === 0).length / blocks.length) * 100);
}

/** Best achievable turnout, as a percentage of everyone who answered. */
export function bestTurnoutPercent(result: OverlapResult | null): number {
  const total = respondentCount(result);
  if (!total || !result) return 0;
  const best = result.bestWindowCount ?? Math.max(...result.blocks.map((b) => b.count), 0);
  return Math.round((best / total) * 100);
}

/**
 * Best headcount per day, chronologically. Shows which days are worth keeping
 * and which are dead weight on the grid.
 */
export function dayTurnout(result: OverlapResult | null): DayTurnout[] {
  const byDay = new Map<string, number>();
  for (const block of result?.blocks ?? []) {
    const date = block.blockId.split('T')[0];
    byDay.set(date, Math.max(byDay.get(date) ?? 0, block.count));
  }
  return Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, best]) => ({
      date,
      best,
      label: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    }));
}
