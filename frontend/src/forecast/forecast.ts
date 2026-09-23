import { environmentAt } from './environment';

export type TurbineStatus = 'active' | 'warning' | 'offline';
export interface Turbine { id: string; name: string; region: string; lat: number; lon: number; status: TurbineStatus }
export interface Reading { turbineId: string; windSpeed: number; temperature: number; direction: number; power: number; condition: 'sun' | 'cloud' }
export interface ForecastHour { at: string; readings: Reading[] }

// Illustrative layout coordinates, not real wind farm geography.
export const turbines: Turbine[] = [
  { id: 'T01', name: 'Turbine 01', region: 'North ridge', lat: 62, lon: -42, status: 'active' },
  { id: 'T02', name: 'Turbine 02', region: 'East meadow', lat: 35, lon: 34, status: 'active' },
  { id: 'T03', name: 'Turbine 03', region: 'West grove', lat: 25, lon: -54, status: 'active' },
  { id: 'T04', name: 'Turbine 04', region: 'Highland', lat: 68, lon: 115, status: 'active' },
  { id: 'T05', name: 'Turbine 05', region: 'South field', lat: -14, lon: 18, status: 'warning' },
  { id: 'T06', name: 'Turbine 06', region: 'Far valley', lat: 15, lon: 158, status: 'offline' },
];

export function powerFromWind(speed: number): number {
  if (!Number.isFinite(speed) || speed < 3 || speed >= 25) return 0;
  return 3.6 * Math.min(1, (speed ** 3 - 3 ** 3) / (12 ** 3 - 3 ** 3));
}

export const DEFAULT_DATE = '2026-09-23';
export function createForecast(date: string): ForecastHour[] {
  const calendar = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid forecast date.');
  }
  const origin = Date.parse(`${date}T09:00:00+05:00`);
  return Array.from({ length: 48 }, (_, h) => {
    const at = new Date(origin + h * 3600000).toISOString();
    const env = environmentAt(at);
    const temperature = { winter: -6, spring: 12, summer: 26, autumn: 16 }[env.season];
    return { at, readings: turbines.map((t, i) => {
      const windSpeed = 8.7 + Math.sin(h / 5 + i * 0.3) * 2.1 + Math.cos(h / 2.8 + i) * 0.65;
      return { turbineId: t.id, windSpeed, temperature: temperature + Math.sin((env.hour - 8) / 24 * Math.PI * 2) * 5 - i * 0.2, direction: Math.round(42 + Math.sin(h / 8) * 18), power: t.status === 'offline' ? 0 : powerFromWind(windSpeed), condition: (h + i) % 7 < 3 ? 'cloud' : 'sun' };
    }) };
  });
}
export const forecast = createForecast(DEFAULT_DATE);

export function summarize(hour: ForecastHour) {
  const total = hour.readings.reduce((a, r) => ({ power: a.power + r.power, windSpeed: a.windSpeed + r.windSpeed, temperature: a.temperature + r.temperature, direction: a.direction + r.direction }), { power: 0, windSpeed: 0, temperature: 0, direction: 0 });
  const n = hour.readings.length || 1;
  return { power: total.power, windSpeed: total.windSpeed / n, temperature: total.temperature / n, direction: Math.round(total.direction / n) };
}

export function hourLabel(at: string, includeDate = false) {
  const date = new Date(at);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit' }).format(date);
  return includeDate ? `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', day: 'numeric', month: 'short' }).format(date)} · ${time}` : time;
}

// Local deterministic demo, deliberately no API keys or implied live AI service.
export function answerQuestion(question: string, hours: ForecastHour[]): string {
  if (!hours.length) return 'No forecast is available for this period.';
  if (/peak|best|highest|maximum|power|output|energy/i.test(question)) {
    const peak = hours.reduce((best, h) => summarize(h).power > summarize(best).power ? h : best);
    const energy = hours.reduce((total, h) => total + summarize(h).power, 0);
    return `In this ${hours.length}-hour demo forecast, output peaks at ${summarize(peak).power.toFixed(1)} MW on ${hourLabel(peak.at, true)} (UTC+5). Total forecast energy is ${energy.toFixed(1)} MWh. These are illustrative values, not operational predictions.`;
  }
  if (/wind|weather|temperature/i.test(question)) {
    const speeds = hours.map(h => summarize(h).windSpeed);
    return `Average farm wind ranges from ${Math.min(...speeds).toFixed(1)} to ${Math.max(...speeds).toFixed(1)} m/s over the selected ${hours.length} hours. Move the timeline to explore how weather changes each turbine’s output. This is mock weather data.`;
  }
  return 'I can explore this local demo forecast. Try asking “When is peak power?” or “What is the wind outlook?”. No live AI service is connected.';
}
