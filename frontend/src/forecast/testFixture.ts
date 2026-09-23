import { parseForecast } from './forecast';

export function fixture(mode: 'historical' | 'live' = 'historical', issueOverride?: string) {
  const issue = issueOverride ?? (mode === 'historical' ? '2026-01-30T19:00:00+00:00' : new Date(new Date().setUTCMinutes(0, 0, 0)).toISOString());
  const weather = [];
  const forecast = [];
  for (let lead = 1; lead <= 48; lead++) {
    for (const turbine_id of ['1', '2']) {
      const valid_time_utc = new Date(Date.parse(issue) + lead * 3600000).toISOString();
      weather.push({ turbine_id, lead_hour: lead, valid_time_utc, wind_speed_10m: 5, wind_speed_100m: 7 + lead / 10, wind_direction_100m: 180, temperature_2m: 4, surface_pressure: 1000 });
      forecast.push({ turbine_id, lead_hour: lead, valid_time_utc, predicted_power: lead / 48 });
    }
  }
  return {
    metadata: { mode, issue_time_utc: issue, target_start_utc: issue, run_time_utc: mode === 'historical' ? '2026-01-30T12:00:00+00:00' : null, retrieved_at_utc: mode === 'live' ? issue : null, weather_source: mode === 'historical' ? 'Open-Meteo Single Runs API' : 'Open-Meteo ECMWF Forecast API', weather_model: 'ecmwf_ifs', model_version: 'test', run_id: 'test', weather_sha256: 'test-weather', created_at_utc: issue, power_unit: 'normalized line-side active power' },
    sites: [{ id: '1', name: 'Turbine 1', latitude: 43.645150, longitude: 78.535604 }, { id: '2', name: 'Turbine 2', latitude: 43.643198, longitude: 78.538828 }],
    weather, forecast, analysis: {},
  };
}
export function parsedFixture() { return parseForecast(fixture()); }
