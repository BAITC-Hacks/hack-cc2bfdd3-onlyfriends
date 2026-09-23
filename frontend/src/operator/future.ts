import { summarize, type ForecastHour } from '../forecast/forecast';

export interface FutureEvent { index: number; kind: 'peak' | 'wind' | 'maintenance'; label: string; detail: string }

function circularDirection(hour: ForecastHour) {
  const radians = hour.readings.map(reading => reading.direction * Math.PI / 180);
  const east = radians.reduce((sum, angle) => sum + Math.sin(angle), 0);
  const north = radians.reduce((sum, angle) => sum + Math.cos(angle), 0);
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

function angleChange(current: number, previous: number) {
  return ((current - previous + 540) % 360) - 180;
}

export function futureEvents(hours: ForecastHour[], maintenanceIndex: number): FutureEvent[] {
  if (!hours.length) return [];
  const summaries = hours.map(summarize);
  const peakIndex = summaries.reduce((best, value, index) => value.power > summaries[best].power ? index : best, 0);
  let windIndex = -1, windRise = 0;
  for (let index = 1; index < summaries.length; index++) {
    const rise = summaries[index].windSpeed - summaries[index - 1].windSpeed;
    if (rise > windRise) { windRise = rise; windIndex = index; }
  }
  const events: FutureEvent[] = [{ index: peakIndex, kind: 'peak', label: 'Peak output', detail: `${summaries[peakIndex].power.toFixed(3)} / ${hours[peakIndex].readings.length} normalized` }];
  if (windIndex >= 0) events.push({ index: windIndex, kind: 'wind', label: 'Wind rising', detail: `+${windRise.toFixed(1)} m/s from prior hour` });
  if (maintenanceIndex >= 0 && maintenanceIndex < hours.length) events.push({ index: maintenanceIndex, kind: 'maintenance', label: 'Maintenance window', detail: 'Lowest predicted shutdown loss' });
  return events.sort((a, b) => a.index - b.index);
}

export interface ForecastRevision { at: string; powerChange: number; previousPower: number; currentPower: number; directionChange: number; comparedHours: number }

/** Compare only shared valid timestamps from two archived issue forecasts. */
export function forecastRevision(current: ForecastHour[], previous: ForecastHour[]): ForecastRevision | null {
  const priorByHour = new Map(previous.map(hour => [hour.at, hour]));
  let result: ForecastRevision | null = null, comparedHours = 0;
  for (const hour of current) {
    const prior = priorByHour.get(hour.at);
    if (!prior) continue;
    comparedHours++;
    const currentPower = summarize(hour).power, previousPower = summarize(prior).power;
    const powerChange = currentPower - previousPower;
    if (!result || Math.abs(powerChange) > Math.abs(result.powerChange)) {
      result = { at: hour.at, powerChange, previousPower, currentPower,
        directionChange: angleChange(circularDirection(hour), circularDirection(prior)), comparedHours: 0 };
    }
  }
  return result && { ...result, comparedHours };
}

export function explainHour(hours: ForecastHour[], index: number) {
  if (index < 1 || index >= hours.length) return null;
  const current = summarize(hours[index]), previous = summarize(hours[index - 1]);
  return { powerChange: current.power - previous.power,
    windChange: current.windSpeed - previous.windSpeed,
    directionChange: angleChange(circularDirection(hours[index]), circularDirection(hours[index - 1])) };
}
