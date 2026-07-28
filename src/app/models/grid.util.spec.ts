import {
  eventEndSummary,
  formatDuration,
  generateGrid,
  minutesToClockLabel,
  timeStringToMinutes,
} from './grid.util';

describe('generateGrid', () => {
  it('matches the backend test fixture: America/New_York August 08:00 -> 12:00 UTC (EDT, UTC-4)', () => {
    const blocks = generateGrid({
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      dayStartMinute: 8 * 60,
      dayEndMinute: 9 * 60,
      granularityMinutes: 30,
      timezone: 'America/New_York',
    });

    expect(blocks.length).toBe(2);
    const first = blocks.find((b) => b.blockId === '2026-08-03T08:00');
    expect(first).toBeTruthy();
    const parsed = new Date(first!.utcInstant);
    expect(parsed.getUTCHours()).toBe(12);
    expect(parsed.getUTCDate()).toBe(3);
  });

  it('excludes a block starting exactly at dayEndMinute (exclusive window)', () => {
    const blocks = generateGrid({
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      dayStartMinute: 8 * 60,
      dayEndMinute: 9 * 60,
      granularityMinutes: 30,
      timezone: 'America/New_York',
    });
    const blockIds = blocks.map((b) => b.blockId);
    expect(blockIds).not.toContain('2026-08-03T09:00');
    expect(blockIds).toContain('2026-08-03T08:30');
  });

  it('produces blocks in chronological (UTC) order', () => {
    const blocks = generateGrid({
      startDate: '2026-08-03',
      endDate: '2026-08-05',
      dayStartMinute: 8 * 60,
      dayEndMinute: 12 * 60,
      granularityMinutes: 30,
      timezone: 'America/New_York',
    });
    const utcValues = blocks.map((b) => b.utcInstant);
    expect(utcValues).toEqual([...utcValues].sort());
  });

  it('does not throw across a spring-forward DST boundary (America/New_York 2026-03-08)', () => {
    expect(() =>
      generateGrid({
        startDate: '2026-03-08',
        endDate: '2026-03-08',
        dayStartMinute: 1 * 60,
        dayEndMinute: 4 * 60,
        granularityMinutes: 30,
        timezone: 'America/New_York',
      }),
    ).not.toThrow();
  });

  it('different timezones produce different UTC instants for the same wall-clock label', () => {
    const config = {
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      dayStartMinute: 8 * 60,
      dayEndMinute: 9 * 60,
      granularityMinutes: 30,
    };
    const ny = generateGrid({ ...config, timezone: 'America/New_York' });
    const la = generateGrid({ ...config, timezone: 'America/Los_Angeles' });
    expect(ny[0].utcInstant).not.toBe(la[0].utcInstant);
  });

  it('rolls an overnight window (dayEnd > 1440) into the next calendar day', () => {
    // earliest = latest = 22:00, 3h event -> dayStart 1320, dayEnd 1500.
    const blocks = generateGrid({
      startDate: '2026-08-03',
      endDate: '2026-08-03',
      dayStartMinute: 22 * 60,
      dayEndMinute: 22 * 60 + 180,
      granularityMinutes: 15,
      timezone: 'America/New_York',
    });
    const ids = blocks.map((b) => b.blockId);
    expect(ids[0]).toBe('2026-08-03T22:00');
    expect(ids).toContain('2026-08-03T23:45');
    expect(ids).toContain('2026-08-04T00:00'); // rolled past midnight
    expect(ids).toContain('2026-08-04T00:45'); // last block (dayEnd exclusive)
    expect(ids).not.toContain('2026-08-04T01:00');
    expect(ids.length).toBe(12);
    // Still chronological + 15 min apart across the midnight roll.
    const utc = blocks.map((b) => b.utcInstant);
    expect(utc).toEqual([...utc].sort());
  });
});

describe('timeStringToMinutes', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(timeStringToMinutes('00:00')).toBe(0);
    expect(timeStringToMinutes('22:00')).toBe(1320);
    expect(timeStringToMinutes('09:30')).toBe(570);
  });

  it('returns null for blank or malformed input', () => {
    expect(timeStringToMinutes('')).toBeNull();
    expect(timeStringToMinutes(null)).toBeNull();
    expect(timeStringToMinutes('nope')).toBeNull();
  });
});

describe('minutesToClockLabel', () => {
  it('formats a 12-hour clock label', () => {
    expect(minutesToClockLabel(0)).toBe('12:00 AM');
    expect(minutesToClockLabel(13 * 60)).toBe('1:00 PM');
    expect(minutesToClockLabel(22 * 60)).toBe('10:00 PM');
  });

  it('wraps past-midnight minutes to the next-day wall clock', () => {
    expect(minutesToClockLabel(25 * 60)).toBe('1:00 AM'); // 1500 minutes
  });
});

describe('eventEndSummary', () => {
  it('computes a same-day end time', () => {
    const s = eventEndSummary(18 * 60, 120); // 6 PM + 2h -> 8 PM
    expect(s.label).toBe('8:00 PM');
    expect(s.nextDay).toBeFalse();
  });

  it('flags an overnight end time', () => {
    const s = eventEndSummary(22 * 60, 180); // 10 PM + 3h -> 1 AM next day
    expect(s.label).toBe('1:00 AM');
    expect(s.nextDay).toBeTrue();
  });
});

describe('formatDuration', () => {
  it('formats sub-hour durations in minutes', () => {
    expect(formatDuration(30)).toBe('30 minutes');
    expect(formatDuration(1)).toBe('1 minute');
  });

  it('formats whole-hour durations without a decimal', () => {
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(300)).toBe('5 hours');
  });

  it('formats fractional-hour durations to one decimal', () => {
    expect(formatDuration(90)).toBe('1.5 hours');
  });
});
