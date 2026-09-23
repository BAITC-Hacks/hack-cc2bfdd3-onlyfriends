import { describe, expect, it } from 'vitest';
import type { ForecastHour } from '../forecast/forecast';
import { forecastRevision, futureEvents, explainHour } from './future';

function hour(index: number, power: number, wind: number, direction = 350): ForecastHour {
  return { at: new Date(Date.UTC(2026, 1, 2, index)).toISOString(), readings: [
    { turbineId: '1', power, windSpeed: wind, windSpeed100: wind, windSpeed10: wind - 1, temperature: 0, pressure: 1000, direction },
    { turbineId: '2', power, windSpeed: wind, windSpeed100: wind, windSpeed10: wind - 1, temperature: 0, pressure: 1000, direction },
  ] };
}

describe('future summaries', () => {
  it('finds the peak, steepest wind rise, and chosen maintenance window in time order', () => {
    const hours = [hour(0, 0.2, 3), hour(1, 0.9, 4), hour(2, 0.6, 8), hour(3, 0.3, 7)];
    const events = futureEvents(hours, 3);
    expect(events.map(event => event.index)).toEqual([1, 2, 3]);
    expect(events.find(event => event.kind === 'wind')?.detail).toContain('+4.0 m/s');
    expect(events.find(event => event.kind === 'maintenance')?.label).toContain('Maintenance');
  });

  it('compares only matching valid hours from the prior issue and handles wraparound direction', () => {
    const current = [hour(0, 0.3, 5, 10), hour(1, 0.8, 6, 15)];
    const previous = [hour(0, 0.2, 5, 350), hour(1, 0.2, 5, 350), hour(3, 0.9, 8)];
    const revision = forecastRevision(current, previous);
    expect(revision?.at).toBe(current[1].at);
    expect(revision?.powerChange).toBeCloseTo(1.2);
    expect(revision?.directionChange).toBeCloseTo(25);
    expect(forecastRevision(current, [hour(3, 0.1, 2)])).toBeNull();
  });

  it('explains a selected change as observations rather than invented feature attribution', () => {
    const explanation = explainHour([hour(0, 0.2, 3, 350), hour(1, 0.5, 7, 10)], 1);
    expect(explanation?.powerChange).toBeCloseTo(0.6);
    expect(explanation?.windChange).toBeCloseTo(4);
    expect(explanation?.directionChange).toBeCloseTo(20);
    expect(explainHour([hour(0, 0.2, 3)], 0)).toBeNull();
  });
});
