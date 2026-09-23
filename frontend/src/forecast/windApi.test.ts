import { describe, expect, it, vi } from 'vitest';
import { buildWindRunUrl, fetchWindRun, parseWindRun, windFlow } from './windApi';

const payload = { hourly: {
  time: ['2026-01-31T20:00', '2026-01-31T21:00'],
  wind_speed_100m: [1.47, 2.5], wind_direction_100m: [288, 0],
} };

describe('archived wind API', () => {
  it('requests the ECMWF run used by the selected issue in metres per second', () => {
    const url = new URL(buildWindRunUrl('2026-01-31T12:00:00Z', 43.64515, 78.535604));
    expect(url.hostname).toBe('single-runs-api.open-meteo.com');
    expect(url.searchParams.get('run')).toBe('2026-01-31T12:00');
    expect(url.searchParams.get('models')).toBe('ecmwf_ifs');
    expect(url.searchParams.get('wind_speed_unit')).toBe('ms');
  });
  it('validates hourly data and converts meteorological direction to terrain flow', () => {
    expect(parseWindRun(payload)[0]).toEqual({ at: '2026-01-31T20:00:00Z', speed: 1.47, direction: 288 });
    expect(windFlow(0)).toEqual([0, 1]);
    expect(windFlow(90)[0]).toBeCloseTo(-1);
    expect(() => parseWindRun({ hourly: { ...payload.hourly, wind_speed_100m: [null, 2.5] } })).toThrow(/wind/i);
  });
  it('reports provider failure instead of claiming API data', async () => {
    const request = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchWindRun('2026-01-31T12:00:00Z', 43.64515, 78.535604, undefined, request)).rejects.toThrow(/503/);
  });
});
