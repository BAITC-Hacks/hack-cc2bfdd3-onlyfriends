import { describe, expect, it } from 'vitest';
import { forecast, turbines, monthForecast, summarize, answerQuestion, createForecast, issueRunTime } from './forecast';

describe('archived February forecast', () => {
  it('uses the two case turbines and the archived February issue', () => {
    expect(turbines.map(({ id, lat, lon }) => ({ id, lat, lon }))).toEqual([
      { id: '1', lat: 43.64515, lon: 78.535604 },
      { id: '2', lat: 43.643198, lon: 78.538828 },
    ]);
    const firstHour = createForecast('2026-02-01')[0];
    expect(firstHour.at).toBe('2026-01-31T20:00:00Z');
    expect(firstHour.readings.map(reading => reading.power)).toEqual([
      0.0141419070706263, 0.0121572086426179,
    ]);
    expect(issueRunTime('2026-02-01')).toBe('2026-01-31T12:00:00Z');
  });
  it('provides 48 consecutive hourly readings for every turbine', () => {
    expect(forecast).toHaveLength(48);
    forecast.forEach((hour, i) => {
      expect(Date.parse(hour.at) - Date.parse(forecast[0].at)).toBe(i * 3600000);
      expect(hour.readings).toHaveLength(turbines.length);
      hour.readings.forEach(r => {
        expect(r.power).toBeGreaterThanOrEqual(0);
        expect(r.power).toBeLessThanOrEqual(1);
      });
    });
  });
  it('covers every local February hour and rejects dates without archived issues', () => {
    expect(monthForecast).toHaveLength(672);
    expect(monthForecast[0].at).toBe('2026-01-31T19:00:00Z');
    expect(monthForecast.at(-1)?.at).toBe('2026-02-28T18:00:00Z');
    expect(() => createForecast('2026-07-01')).toThrow(/No archived forecast/);
  });
  it('aggregates only the selected hour', () => {
    expect(summarize(forecast[0]).power).toBeCloseTo(forecast[0].readings.reduce((sum, r) => sum + r.power, 0));
    expect(summarize(forecast[0]).power).not.toBe(summarize(forecast[12]).power);
  });
  it('answers from the selected horizon and admits unsupported questions', () => {
    expect(answerQuestion('peak power', forecast.slice(0, 24))).toContain('normalized');
    expect(answerQuestion('buy me a car', forecast)).toContain('Try asking');
    const unsupportedStop = answerQuestion('Stop turbine 9 for four hours tomorrow. Find the best window.', forecast);
    expect(unsupportedStop).toContain('maintenance');
    expect(unsupportedStop).not.toContain('peaks');
  });
});
