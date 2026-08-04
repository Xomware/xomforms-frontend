import {
  bestTurnoutPercent,
  dayTurnout,
  deadSlotPercent,
  hasAnalytics,
  respondentCount,
  unanimousCount,
} from './analytics.util';
import { OverlapResult } from './response.model';

function result(partial: Partial<OverlapResult> = {}): OverlapResult {
  return {
    pollId: 'p1',
    totalRespondents: 4,
    blocks: [
      { blockId: '2026-08-03T18:00', utcInstant: '', count: 4, total: 4, ratio: 1 },
      { blockId: '2026-08-03T18:30', utcInstant: '', count: 2, total: 4, ratio: 0.5 },
      { blockId: '2026-08-04T18:00', utcInstant: '', count: 0, total: 4, ratio: 0 },
      { blockId: '2026-08-04T18:30', utcInstant: '', count: 1, total: 4, ratio: 0.25 },
    ],
    bestBlockIds: ['2026-08-03T18:00'],
    ...partial,
  };
}

describe('analytics.util', () => {
  it('counts respondents', () => {
    expect(respondentCount(result())).toBe(4);
  });

  it('counts times everyone is free', () => {
    expect(unanimousCount(result())).toBe(1);
  });

  it('reports the share nobody can make', () => {
    expect(deadSlotPercent(result())).toBe(25);
  });

  it('prefers the contiguous-window headcount when present', () => {
    // bestWindowCount accounts for the event length; the per-block max does
    // not, so using the max would overstate turnout on a multi-slot event.
    expect(bestTurnoutPercent(result({ bestWindowCount: 2 }))).toBe(50);
    expect(bestTurnoutPercent(result())).toBe(100);
  });

  it('breaks turnout down by day, chronologically', () => {
    const days = dayTurnout(result());
    expect(days.length).toBe(2);
    expect(days[0].date).toBe('2026-08-03');
    expect(days[0].best).toBe(4);
    expect(days[1].best).toBe(1);
  });

  // Both views render before the first response lands, so every one of these
  // has to survive an empty result rather than dividing by zero.
  it('survives no respondents', () => {
    const empty = result({ totalRespondents: 0, blocks: [] });
    expect(hasAnalytics(empty)).toBeFalse();
    expect(bestTurnoutPercent(empty)).toBe(0);
    expect(deadSlotPercent(empty)).toBe(0);
    expect(unanimousCount(empty)).toBe(0);
    expect(dayTurnout(empty)).toEqual([]);
  });

  it('survives a null result entirely', () => {
    expect(hasAnalytics(null)).toBeFalse();
    expect(respondentCount(null)).toBe(0);
    expect(bestTurnoutPercent(null)).toBe(0);
    expect(deadSlotPercent(null)).toBe(0);
    expect(dayTurnout(null)).toEqual([]);
  });

  it('is not analytics-ready with respondents but no blocks', () => {
    expect(hasAnalytics(result({ blocks: [] }))).toBeFalse();
  });
});
