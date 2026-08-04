import { timezoneLabel, timezoneShortLabel } from './grid.util';

describe('timezoneLabel', () => {
  // Fixed summer date so the seasonal-name collapse is exercised, not dodged.
  const summer = new Date('2026-08-04T12:00:00Z');

  it('turns an IANA id into something a person recognises', () => {
    expect(timezoneLabel('America/New_York', summer)).toBe('Eastern Time — New York');
    expect(timezoneLabel('America/Los_Angeles', summer)).toBe('Pacific Time — Los Angeles');
  });

  it('collapses the seasonal name so a form does not appear to move zones', () => {
    // Intl says "Eastern Daylight Time" in August and "Eastern Standard Time"
    // in January; the form has not changed timezone in between.
    const winter = new Date('2026-01-04T12:00:00Z');
    expect(timezoneLabel('America/New_York', winter)).toBe(
      timezoneLabel('America/New_York', summer),
    );
  });

  it('reads underscores as spaces', () => {
    expect(timezoneLabel('America/Los_Angeles', summer)).toContain('Los Angeles');
    expect(timezoneLabel('America/Los_Angeles', summer)).not.toContain('_');
  });

  it('uses the last path segment for nested zones', () => {
    expect(timezoneLabel('America/Indiana/Indianapolis', summer)).toContain('Indianapolis');
  });

  it('leaves UTC alone rather than padding it out', () => {
    expect(timezoneLabel('UTC', summer)).toBe('UTC');
    expect(timezoneLabel('Etc/UTC', summer)).toBe('UTC');
  });

  it('falls back to the city for an unknown zone instead of throwing', () => {
    expect(timezoneLabel('Mars/Olympus_Mons', summer)).toBe('Olympus Mons');
  });

  it('is empty for a missing zone', () => {
    expect(timezoneLabel(undefined)).toBe('');
    expect(timezoneLabel(null)).toBe('');
  });

  it('short form drops the city', () => {
    expect(timezoneShortLabel('America/New_York')).toBe('Eastern Time');
    expect(timezoneShortLabel('UTC')).toBe('UTC');
  });
});
