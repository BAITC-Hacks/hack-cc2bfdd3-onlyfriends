import { describe, expect, it, vi } from 'vitest';
import { askForecast, parseForecast, summarize } from './forecast';
import { fixture } from './testFixture';

describe('forecast transport', () => {
  it('joins real weather and model power by turbine, hour, and timestamp', () => {
    const document = parseForecast(fixture());
    expect(document.hours).toHaveLength(48);
    expect(document.turbines.map(turbine => turbine.id)).toEqual(['1', '2']);
    expect(document.hours[0].readings[0].windSpeed).toBeCloseTo(7.1);
    expect(document.hours[0].readings[0].power).toBeCloseTo(1 / 48);
    expect(summarize(document.hours[47]).power).toBe(1);
  });
  it('rejects missing or forged model output', () => {
    const incomplete = fixture();
    incomplete.forecast.pop();
    expect(() => parseForecast(incomplete)).toThrow('incomplete');
    const invalid = fixture();
    invalid.forecast[0].predicted_power = 3.6;
    expect(() => parseForecast(invalid)).toThrow('invalid');
  });
  it('sends the selected forecast context for Russian questions', async () => {
    const request = { run_id: 'a'.repeat(20), question: 'Почему сегодня сильный ветер?', selected_lead_hour: 4, selected_turbine_id: '2', horizon: 24 as const };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'На 23 февраля прогнозируется сильный ветер.' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await askForecast(request)).toContain('23 февраля');
    expect(fetchMock).toHaveBeenCalledWith('/api/ask', expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }));
    vi.unstubAllGlobals();
  });
});
