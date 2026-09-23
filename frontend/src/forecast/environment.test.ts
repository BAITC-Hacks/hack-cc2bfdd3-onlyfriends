import { describe, expect, it } from 'vitest';
import { environmentAt } from './environment';
import { createForecast } from './forecast';

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
  it('generates date-specific hourly fixtures across a season boundary', () => {
    const hours = createForecast('2026-02-28');
    expect(hours).toHaveLength(48);
    expect(environmentAt(hours[0].at).season).toBe('winter');
    expect(environmentAt(hours[47].at).season).toBe('spring');
    expect(hours[0].readings[0].temperature).toBeLessThan(createForecast('2026-07-01')[0].readings[0].temperature);
    expect(() => createForecast('2026-02-30')).toThrow();
  });
});
