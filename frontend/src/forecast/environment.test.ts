import { describe, expect, it } from 'vitest';
import { environmentAt } from './environment';
import { fixture } from './testFixture';

describe('forecast environment in UTC+5', () => {
  it.each([[2, 'night'], [7, 'sunrise'], [13, 'day'], [19, 'sunset'], [23, 'night']])('classifies hour %s as %s', (hour, expected) => {
    expect(environmentAt(`2026-02-01T${String(hour).padStart(2, '0')}:00:00+05:00`).timeOfDay).toBe(expected);
  });
  it.each([['01', 'winter'], ['04', 'spring'], ['07', 'summer'], ['10', 'autumn']])('classifies month %s as %s', (month, season) => {
    expect(environmentAt(`2026-${month}-01T13:00:00+05:00`).season).toBe(season);
  });
  it('uses local date at UTC month boundaries, regardless of host timezone', () => {
    expect(environmentAt('2026-02-28T20:00:00Z').season).toBe('spring');
    expect(environmentAt('2026-02-28T20:00:00Z').hour).toBe(1);
    expect(() => environmentAt('invalid')).toThrow();
  });
  it('changes season across a recorded 48-hour forecast issue', () => {
    const response = fixture('historical', '2026-02-27T19:00:00Z');
    expect(environmentAt(response.weather[0].valid_time_utc).season).toBe('winter');
    expect(environmentAt(response.weather[response.weather.length - 1].valid_time_utc).season).toBe('spring');
  });
});
