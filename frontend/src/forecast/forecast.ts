import archived from '../data/february2026.json';

export type TurbineStatus = 'active' | 'warning' | 'offline';
export interface Turbine { id: string; name: string; region: string; lat: number; lon: number; status: TurbineStatus }
export interface Reading { turbineId: string; windSpeed: number; windSpeed10: number; windSpeed100: number; temperature: number; pressure: number; direction: number; power: number }
export interface ForecastHour { at: string; readings: Reading[] }

export const turbines: Turbine[] = [
  { id: '1', name: 'Turbine 1', region: 'Shelek', lat: 43.64515, lon: 78.535604, status: 'active' },
  { id: '2', name: 'Turbine 2', region: 'Shelek', lat: 43.643198, lon: 78.538828, status: 'active' },
];

function adapt(hours: typeof archived.month): ForecastHour[] {
  return hours.map(hour => ({ at: hour.at, readings: hour.readings.map(reading => ({
    ...reading, windSpeed: reading.windSpeed100,
  })) }));
}

export const DEFAULT_DATE = '2026-02-01';
export const monthForecast = adapt(archived.month);
export const availableDates = archived.issues.map(issue => issue.date);

export function issueRunTime(date: string): string {
  const issue = archived.issues.find(item => item.date === date);
  if (!issue) throw new Error('No archived forecast for this date.');
  return issue.runTime;
}

export function createForecast(date: string): ForecastHour[] {
  const issue = archived.issues.find(item => item.date === date);
  if (!issue) throw new Error('No archived forecast for this date.');
  return adapt(issue.hours);
}
export const forecast = createForecast(DEFAULT_DATE);

export function summarize(hour: ForecastHour) {
  const total = hour.readings.reduce((a, r) => ({ power: a.power + r.power, windSpeed: a.windSpeed + r.windSpeed, windSpeed10: a.windSpeed10 + r.windSpeed10, temperature: a.temperature + r.temperature, pressure: a.pressure + r.pressure, direction: a.direction + r.direction }), { power: 0, windSpeed: 0, windSpeed10: 0, temperature: 0, pressure: 0, direction: 0 });
  const n = hour.readings.length || 1;
  return { power: total.power, windSpeed: total.windSpeed / n, windSpeed10: total.windSpeed10 / n, temperature: total.temperature / n, pressure: total.pressure / n, direction: Math.round(total.direction / n) };
}

export function hourLabel(at: string, includeDate = false) {
  const date = new Date(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(date);
  return includeDate ? `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'short' }).format(date)} · ${time}` : time;
}

export function answerQuestion(question: string, hours: ForecastHour[]): string {
  if (!hours.length) return 'No forecast is available for this period.';
  if (/peak|best|highest|maximum|power|output|energy/i.test(question)) {
    const peak = hours.reduce((best, h) => summarize(h).power > summarize(best).power ? h : best);
    return `In this ${hours.length}-hour archived forecast, combined normalized output peaks at ${summarize(peak).power.toFixed(3)} of 2.0 on ${hourLabel(peak.at, true)} (UTC+5). Physical MW and actual February generation are unavailable.`;
  }
  if (/wind|weather|temperature/i.test(question)) {
    const speeds = hours.map(h => summarize(h).windSpeed);
    return `Archived 100 m wind forecast ranges from ${Math.min(...speeds).toFixed(1)} to ${Math.max(...speeds).toFixed(1)} m/s over the selected ${hours.length} hours.`;
  }
  return 'I can explain this archived February forecast. Try asking “When is peak power?” or “What is the wind outlook?”. No live AI service is connected.';
}
