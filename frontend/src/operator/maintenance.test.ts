import { describe, expect, it } from 'vitest';
import { createForecast, type ForecastHour } from '../forecast/forecast';
import { applyShutdown, localDayBounds, planMaintenance, scenarioOutput } from './maintenance';

function hours(outputs: number[]): ForecastHour[] {
  return outputs.map((power, index) => ({
    at: new Date(Date.UTC(2026, 1, 1, index)).toISOString(),
    readings: [
      { turbineId: '1', power, windSpeed: 4, windSpeed10: 3, windSpeed100: 4, direction: 90, temperature: 0, pressure: 1000 },
      { turbineId: '2', power: 0.5, windSpeed: 4, windSpeed10: 3, windSpeed100: 4, direction: 90, temperature: 0, pressure: 1000 },
    ],
  }));
}

describe('maintenance planning', () => {
  it('checks every contiguous window and picks the lowest lost normalized turbine-hours', () => {
    const plan = planMaintenance(hours([0.8, 0.7, 0.1, 0.2, 0.1, 0.9, 0.4, 0.5]), '1', 3, 0);
    expect(plan.candidateCount).toBe(6);
    expect(plan.recommended.startIndex).toBe(2);
    expect(plan.recommended.endIndex).toBe(5);
    expect(plan.recommended.lost).toBeCloseTo(0.4);
    expect(plan.recommended.farmAfter).toBeCloseTo(1.5);
    expect(plan.alternative?.startIndex).toBe(5);
    expect(plan.avoidedLossPercent).toBeCloseTo((1 - 0.4 / 1.8) * 100);
  });

  it('limits a tomorrow request to the second 24 hours and accepts the final valid start', () => {
    const values = Array(48).fill(0.9);
    values.splice(44, 4, 0.05, 0.04, 0.03, 0.02);
    const plan = planMaintenance(hours(values), '1', 4, 24);
    expect(plan.candidateCount).toBe(21);
    expect(plan.recommended.startIndex).toBe(44);
    expect(plan.recommended.endIndex).toBe(48);
  });

  it('keeps a calendar-day search inside its exclusive end boundary', () => {
    const values = Array(48).fill(0.9);
    values.splice(23, 4, 0.1, 0.1, 0.1, 0.1);
    values.splice(44, 4, 0, 0, 0, 0);
    const plan = planMaintenance(hours(values), '1', 4, 23, 47);
    expect(plan.candidateCount).toBe(21);
    expect(plan.recommended.startIndex).toBe(23);
    expect(plan.recommended.endIndex).toBe(27);
  });

  it('finds tomorrow by Almaty calendar date in the real archived issue', () => {
    const bounds = localDayBounds(createForecast('2026-02-01'), '2026-02-02');
    expect(bounds).toEqual({ startIndex: 23, endIndex: 47 });
  });

  it('rejects invalid duration, unknown turbine and missing hourly data', () => {
    expect(() => planMaintenance(hours([0.1]), '1', 0, 0)).toThrow(/duration/i);
    expect(() => planMaintenance(hours([0.1]), '3', 1, 0)).toThrow(/turbine/i);
    const gap = hours([0.1, 0.2]);
    gap[1].at = new Date('2026-02-01T03:00:00Z').toISOString();
    expect(() => planMaintenance(gap, '1', 2, 0)).toThrow(/contiguous/i);
  });

  it('does not invent savings when all candidate losses are zero', () => {
    const plan = planMaintenance(hours([0, 0, 0, 0]), '1', 2, 0);
    expect(plan.recommended.lost).toBe(0);
    expect(plan.avoidedLossPercent).toBeNull();
  });

  it('subtracts only the stopped turbine in a what-if scenario', () => {
    const forecast = hours([0.7])[0];
    expect(scenarioOutput(forecast, '1')).toEqual({ baseline: 1.2, scenario: 0.5, lost: 0.7 });
  });

  it('changes only the selected turbine inside the simulated window without mutating the archive', () => {
    const archive = hours([0.4, 0.7, 0.8]);
    const simulated = applyShutdown(archive, '1', 1, 3);
    expect(simulated.map(hour => hour.readings[0].power)).toEqual([0.4, 0, 0]);
    expect(simulated.map(hour => hour.readings[1].power)).toEqual([0.5, 0.5, 0.5]);
    expect(archive[1].readings[0].power).toBe(0.7);
    expect(() => applyShutdown(archive, '1', 2, 5)).toThrow(/window/i);
  });
});
