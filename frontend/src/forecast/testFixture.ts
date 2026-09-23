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
    operations: { unit: 'mean normalized line-side active power of two turbines', mean_24h: 0.2604,
      mean_48h: 0.5104, peak_power: 1, peak_lead_hour: 48,
      peak_time_utc: forecast[forecast.length - 1].valid_time_utc,
      thresholds: { ramp_window_hours: 3, ramp_delta: 0.25, low_output_at_or_below: 0.15, low_output_min_hours: 3 },
      signals: [{ kind: 'low_output' as const, start_lead_hour: 1, end_lead_hour: 7,
        start_utc: forecast[0].valid_time_utc, end_utc: forecast[12].valid_time_utc, hours: 7, mean_power: 0.0833 }] },
    revision: null,
    events: [{ step: 'fetch_weather_run', status: 'SUCCESS' as const }, { step: 'predict_power', status: 'SUCCESS' as const },
      { step: 'assess_operations', status: 'SUCCESS' as const }, { step: 'save_forecast', status: 'SUCCESS' as const }],
  };
}
export function parsedFixture() { return parseForecast(fixture()); }
