export type Season = 'winter' | 'spring' | 'summer' | 'autumn';
export type TimeOfDay = 'night' | 'sunrise' | 'day' | 'sunset';
export interface ForecastEnvironment { timestamp: string; season: Season; timeOfDay: TimeOfDay; hour: number }

/** Fixed UTC+5 demo clock, independent of the browser timezone. Explicit offset required. */
export function environmentAt(timestamp: string): ForecastEnvironment {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error('Forecast timestamps must be valid ISO dates with a timezone.');
  }
  const local = new Date(Date.parse(timestamp) + 5 * 3600000);
  const month = local.getUTCMonth();
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const season: Season = month < 2 || month === 11 ? 'winter' : month < 5 ? 'spring' : month < 8 ? 'summer' : 'autumn';
  const timeOfDay: TimeOfDay = hour < 6 || hour >= 21 ? 'night' : hour < 9 ? 'sunrise' : hour < 18 ? 'day' : 'sunset';
  return { timestamp, season, timeOfDay, hour };
}
