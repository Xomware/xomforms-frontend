import { derivePollStatus } from './poll.model';

describe('derivePollStatus', () => {
  const NOW = Date.parse('2026-07-22T12:00:00Z');

  it('is open when there is no close time', () => {
    expect(derivePollStatus({ closeAt: null }, NOW)).toBe('open');
    expect(derivePollStatus({ closeAt: undefined }, NOW)).toBe('open');
  });

  it('is open when the close time is still in the future', () => {
    expect(derivePollStatus({ closeAt: '2026-07-23T12:00:00Z' }, NOW)).toBe('open');
  });

  it('is closed when the close time is in the past', () => {
    expect(derivePollStatus({ closeAt: '2026-07-21T12:00:00Z' }, NOW)).toBe('closed');
  });

  it('treats an exactly-now close time as still open (strictly-past = closed)', () => {
    expect(derivePollStatus({ closeAt: '2026-07-22T12:00:00Z' }, NOW)).toBe('open');
  });
});
