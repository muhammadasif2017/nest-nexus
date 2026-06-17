import { parseExpiryDate } from './duration.util';

describe('parseExpiryDate()', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('parses seconds', () => {
    expect(parseExpiryDate('30s', 0)).toEqual(new Date('2025-01-01T00:00:30.000Z'));
  });

  it('parses minutes', () => {
    expect(parseExpiryDate('15m', 0)).toEqual(new Date('2025-01-01T00:15:00.000Z'));
  });

  it('parses hours', () => {
    expect(parseExpiryDate('2h', 0)).toEqual(new Date('2025-01-01T02:00:00.000Z'));
  });

  it('parses days', () => {
    expect(parseExpiryDate('7d', 0)).toEqual(new Date('2025-01-08T00:00:00.000Z'));
  });

  it('falls back to fallbackMs when the string has no recognized unit', () => {
    expect(parseExpiryDate('15', 60_000)).toEqual(new Date('2025-01-01T00:01:00.000Z'));
  });

  it('falls back to fallbackMs when the string is not a duration at all', () => {
    expect(parseExpiryDate('garbage', 5_000)).toEqual(new Date('2025-01-01T00:00:05.000Z'));
  });

  it('falls back to fallbackMs for an unsupported unit', () => {
    expect(parseExpiryDate('10w', 1_000)).toEqual(new Date('2025-01-01T00:00:01.000Z'));
  });
});
