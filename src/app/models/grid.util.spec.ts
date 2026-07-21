import { generateGrid } from './grid.util';

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
});
