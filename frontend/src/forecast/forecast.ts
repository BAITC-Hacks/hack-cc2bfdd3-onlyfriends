export interface Turbine { id: string; name: string; lat: number; lon: number }
export interface Reading {
  turbineId: string; windSpeed: number; windSpeed10m: number; temperature: number;
  direction: number; pressure: number; power: number;
}
export interface ForecastHour { at: string; readings: Reading[] }
export interface OperationSignal {
  kind: 'ramp_up' | 'ramp_down' | 'low_output';
  start_lead_hour: number; end_lead_hour: number; start_utc: string; end_utc: string;
  delta?: number; power_before?: number; power_after?: number;
  hours?: number; mean_power?: number;
}
export interface OperationsSummary {
  unit: string; mean_24h: number; mean_48h: number; peak_power: number;
  peak_lead_hour: number; peak_time_utc: string;
  thresholds: { ramp_window_hours: number; ramp_delta: number; low_output_at_or_below: number; low_output_min_hours: number };
  signals: OperationSignal[];
}
export interface RevisionSummary {
  previous_run_id: string; previous_issue_time_utc: string; overlap_hours: number;
  mean_absolute_change: number; largest_change: number; largest_change_time_utc: string;
  weather_changed: boolean; model_changed: boolean;
}
export interface ForecastEvent { step: string; status: 'SUCCESS' | 'FAILED'; error_code?: string }
export interface ForecastDocument {
  metadata: {
    mode: 'historical' | 'live'; issue_time_utc: string; target_start_utc: string; run_time_utc: string | null;
    retrieved_at_utc: string | null; weather_source: string; weather_model: string;
    model_version: string; run_id: string; weather_sha256: string; created_at_utc: string;
    power_unit: string; availability_rule?: string | null; warnings?: string[];
  };
  turbines: Turbine[]; hours: ForecastHour[];
  analysis: Record<string, Record<string, number>>;
  operations: OperationsSummary; revision: RevisionSummary | null; events: ForecastEvent[];
}
type RawPoint = { turbine_id: string; lead_hour: number; valid_time_utc: string };
type RawWeather = RawPoint & { wind_speed_10m: number; wind_speed_100m: number; wind_direction_100m: number; temperature_2m: number; surface_pressure: number };
type RawPower = RawPoint & { predicted_power: number };
type RawDocument = Omit<ForecastDocument, 'turbines' | 'hours'> & { sites: { id: string; name: string; latitude: number; longitude: number }[]; weather: RawWeather[]; forecast: RawPower[] };
function pointKey(point: RawPoint): string { return `${point.turbine_id}/${point.lead_hour}/${point.valid_time_utc}`; }
function finite(value: number): boolean { return typeof value === 'number' && Number.isFinite(value); }

export function parseForecast(raw: RawDocument): ForecastDocument {
  if (!raw?.metadata || raw.sites?.length !== 2 || raw.weather?.length !== 96 || raw.forecast?.length !== 96 || !raw.operations || !Array.isArray(raw.operations.signals) || !Array.isArray(raw.events)) throw new Error('Forecast response is incomplete.');
  if (!['historical', 'live'].includes(raw.metadata.mode) || !raw.metadata.model_version || !raw.metadata.weather_source || !Number.isFinite(Date.parse(raw.metadata.target_start_utc))) throw new Error('Forecast provenance is incomplete.');
  const turbines = raw.sites.map(site => ({ id: site.id, name: site.name, lat: site.latitude, lon: site.longitude }));
  if (new Set(turbines.map(t => t.id)).size !== 2 || turbines.some(t => !finite(t.lat) || !finite(t.lon))) throw new Error('Turbine locations are invalid.');
  const powers = new Map<string, number>();
  for (const row of raw.forecast) {
    const key = pointKey(row);
    if (powers.has(key) || !finite(row.predicted_power) || row.predicted_power < 0 || row.predicted_power > 1) throw new Error('Power forecast is invalid.');
    powers.set(key, row.predicted_power);
  }
  const byLead = new Map<number, ForecastHour>();
  for (const row of raw.weather) {
    const power = powers.get(pointKey(row));
    if (power === undefined || !turbines.some(t => t.id === row.turbine_id) || ![row.wind_speed_10m, row.wind_speed_100m, row.wind_direction_100m, row.temperature_2m, row.surface_pressure].every(finite)) throw new Error('Weather and power rows do not align.');
    if (!Number.isInteger(row.lead_hour) || row.lead_hour < 1 || row.lead_hour > 48 || !Number.isFinite(Date.parse(row.valid_time_utc))) throw new Error('Forecast time is invalid.');
    const hour = byLead.get(row.lead_hour) ?? { at: row.valid_time_utc, readings: [] };
    if (hour.at !== row.valid_time_utc || hour.readings.some(r => r.turbineId === row.turbine_id)) throw new Error('Duplicate or unaligned forecast hour.');
    hour.readings.push({ turbineId: row.turbine_id, windSpeed: row.wind_speed_100m, windSpeed10m: row.wind_speed_10m, temperature: row.temperature_2m, direction: row.wind_direction_100m, pressure: row.surface_pressure, power });
    byLead.set(row.lead_hour, hour);
  }
  const hours = Array.from({ length: 48 }, (_, index) => byLead.get(index + 1));
  if (hours.some((hour, index) => !hour || hour.readings.length !== 2 || Date.parse(hour.at) !== Date.parse(raw.metadata.target_start_utc) + (index + 1) * 3600000)) throw new Error('Forecast must contain 48 aligned hours for both turbines.');
  return { metadata: raw.metadata, turbines, hours: hours as ForecastHour[], analysis: raw.analysis,
    operations: raw.operations, revision: raw.revision ?? null, events: raw.events };
}

export async function fetchForecast(mode: 'historical' | 'live', issue?: string, start?: string): Promise<ForecastDocument> {
  const query = new URLSearchParams({ mode });
  if (mode === 'historical' && issue) query.set('issue', issue);
  if (mode === 'live' && start) query.set('start', start);
  let response: Response;
  try { response = await fetch(`/api/forecast?${query}`); }
  catch { throw new Error('API_UNAVAILABLE: Cannot reach the forecasting service.'); }
  let body: Record<string, unknown>;
  try { body = await response.json(); }
  catch { throw new Error('API_UNAVAILABLE: Forecasting service returned no JSON.'); }
  if (!response.ok) throw new Error(`${body.error_code ?? 'FORECAST_ERROR'}: ${body.message ?? 'Forecast request failed.'}`);
  return parseForecast(body as RawDocument);
}

export interface ForecastQuestion {
  run_id: string; question: string; selected_lead_hour: number;
  selected_turbine_id: string | null; horizon: 24 | 48;
}

export async function askForecast(request: ForecastQuestion): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
  } catch { throw new Error('API_UNAVAILABLE: Cannot reach the forecast assistant.'); }
  let body: { answer?: string; error_code?: string; message?: string };
  try { body = await response.json(); }
  catch { throw new Error('API_UNAVAILABLE: Assistant returned no JSON.'); }
  if (!response.ok) throw new Error(`${body.error_code ?? 'ASSISTANT_ERROR'}: ${body.message ?? 'Assistant request failed.'}`);
  if (typeof body.answer !== 'string' || !body.answer.trim()) throw new Error('ASSISTANT_ERROR: Assistant returned no answer.');
  return body.answer;
}

export function summarize(hour: ForecastHour) {
  const n = hour.readings.length;
  if (!n) throw new Error('Empty forecast hour.');
  return {
    power: hour.readings.reduce((sum, reading) => sum + reading.power, 0) / n,
    windSpeed: hour.readings.reduce((sum, reading) => sum + reading.windSpeed, 0) / n,
    temperature: hour.readings.reduce((sum, reading) => sum + reading.temperature, 0) / n,
  };
}
export function hourLabel(at: string, includeDate = false) {
  const date = new Date(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(date);
  return includeDate ? `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'short' }).format(date)} · ${time}` : time;
}
