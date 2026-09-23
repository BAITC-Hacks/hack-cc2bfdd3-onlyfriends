import { describe, expect, it } from 'vitest';
import { forecast, turbines, powerFromWind, summarize, answerQuestion } from './forecast';

describe('demo forecast', () => {
  it('provides 48 consecutive hourly readings for every turbine', () => {
    expect(forecast).toHaveLength(48);
    forecast.forEach((hour, i) => {
      expect(Date.parse(hour.at) - Date.parse(forecast[0].at)).toBe(i * 3600000);
      expect(hour.readings).toHaveLength(turbines.length);
      hour.readings.forEach(r => {
        expect(r.power).toBeGreaterThanOrEqual(0);
        expect(r.power).toBeLessThanOrEqual(3.6);
      });
    });
  });
  it('honors cut-in, rated and safety cut-out speeds', () => {
    expect(powerFromWind(2)).toBe(0);
    expect(powerFromWind(12)).toBe(3.6);
    expect(powerFromWind(26)).toBe(0);
  });
  it('assigns zero forecast output to the offline demo turbine at every hour', () => {
    const offlineIds = turbines.filter(t => t.status === 'offline').map(t => t.id);
    expect(offlineIds.length).toBeGreaterThan(0);
    forecast.forEach(hour => hour.readings.filter(r => offlineIds.includes(r.turbineId)).forEach(r => expect(r.power).toBe(0)));
  });
  it('aggregates only the selected hour', () => {
    expect(summarize(forecast[0]).power).toBeCloseTo(forecast[0].readings.reduce((sum, r) => sum + r.power, 0));
    expect(summarize(forecast[0]).power).not.toBe(summarize(forecast[12]).power);
  });
  it('answers from the selected horizon and admits unsupported questions', () => {
    expect(answerQuestion('peak power', forecast.slice(0, 24))).toContain('MW');
    expect(answerQuestion('buy me a car', forecast)).toContain('Try asking');
  });
});
