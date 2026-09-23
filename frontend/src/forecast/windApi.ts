export interface WindSample { at: string; speed: number; direction: number }

/** Fetch the same archived ECMWF model run used for the selected February issue. */
export function buildWindRunUrl(runTime: string, latitude: number, longitude: number): string {
  if (!Number.isFinite(Date.parse(runTime)) || !runTime.endsWith('Z')) throw new Error('Invalid UTC model run time.');
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Invalid turbine coordinates.');
  const url = new URL('https://single-runs-api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), run: new Date(runTime).toISOString().slice(0, 16),
    models: 'ecmwf_ifs', hourly: 'wind_speed_100m,wind_direction_100m',
    wind_speed_unit: 'ms', timezone: 'UTC', forecast_hours: '56',
  }).toString();
  return url.toString();
}

export function parseWindRun(payload: unknown): WindSample[] {
  if (!payload || typeof payload !== 'object' || !('hourly' in payload)) throw new Error('Invalid wind API response.');
  const hourly = payload.hourly;
  if (!hourly || typeof hourly !== 'object' || !('time' in hourly) || !('wind_speed_100m' in hourly) || !('wind_direction_100m' in hourly)) throw new Error('Invalid wind API response.');
  const { time, wind_speed_100m: speed, wind_direction_100m: direction } = hourly;
  if (!Array.isArray(time) || !Array.isArray(speed) || !Array.isArray(direction) || !time.length || time.length !== speed.length || time.length !== direction.length) throw new Error('Invalid wind API hourly arrays.');
  return time.map((value, index) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}Z`)) || typeof speed[index] !== 'number' || !Number.isFinite(speed[index]) || speed[index] < 0 || typeof direction[index] !== 'number' || !Number.isFinite(direction[index]) || direction[index] < 0 || direction[index] > 360) throw new Error('Invalid wind API hourly value.');
    return { at: `${value}:00Z`, speed: speed[index], direction: direction[index] };
  });
}

export async function fetchWindRun(runTime: string, latitude: number, longitude: number, signal?: AbortSignal, request: typeof fetch = fetch): Promise<WindSample[]> {
  const response = await request(buildWindRunUrl(runTime, latitude, longitude), { signal });
  if (!response.ok) throw new Error(`Wind API returned ${response.status}.`);
  return parseWindRun(await response.json());
}

/** Meteorological degrees describe where wind comes from; scene axes use east +X and south +Z. */
export function windFlow(direction: number): [number, number] {
  const radians = direction * Math.PI / 180;
  const x = -Math.sin(radians), z = Math.cos(radians);
  return [Math.abs(x) < 1e-10 ? 0 : x, Math.abs(z) < 1e-10 ? 0 : z];
}
