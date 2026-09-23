import type { ForecastHour } from '../forecast/forecast';

export interface MaintenanceWindow {
  startIndex: number;
  endIndex: number;
  startAt: string;
  endAt: string;
  lost: number;
  farmBefore: number;
  farmAfter: number;
}

export interface MaintenancePlan {
  turbineId: string;
  duration: number;
  candidateCount: number;
  recommended: MaintenanceWindow;
  alternative?: MaintenanceWindow;
  avoidedLossPercent: number | null;
}

export function scenarioOutput(hour: ForecastHour, turbineId: string) {
  const reading = hour.readings.find(item => item.turbineId === turbineId);
  if (!reading) throw new Error(`Unknown turbine ${turbineId} in forecast hour ${hour.at}.`);
  const baseline = hour.readings.reduce((sum, item) => sum + item.power, 0);
  if (!Number.isFinite(baseline) || !Number.isFinite(reading.power) || reading.power < 0 || reading.power > 1) {
    throw new RangeError(`Invalid normalized power at ${hour.at}.`);
  }
  return { baseline, scenario: baseline - reading.power, lost: reading.power };
}

/** Rank all complete contiguous windows; losses are normalized turbine-hours, not MWh. */
export function planMaintenance(hours: ForecastHour[], turbineId: string, duration: number, fromIndex = 0, toIndex = hours.length): MaintenancePlan {
  if (!Number.isInteger(duration) || duration < 1) throw new RangeError('Maintenance duration must be a positive whole number of hours.');
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || !Number.isInteger(toIndex) || toIndex > hours.length || fromIndex + duration > toIndex) throw new RangeError('No complete maintenance window in this forecast.');
  for (let index = 0; index < hours.length; index++) {
    scenarioOutput(hours[index], turbineId);
    if (index && Date.parse(hours[index].at) - Date.parse(hours[index - 1].at) !== 3_600_000) {
      throw new RangeError('Forecast hours must be contiguous.');
    }
  }
  const candidates: MaintenanceWindow[] = [];
  for (let startIndex = fromIndex; startIndex + duration <= toIndex; startIndex++) {
    const slice = hours.slice(startIndex, startIndex + duration);
    const lost = slice.reduce((sum, hour) => sum + scenarioOutput(hour, turbineId).lost, 0);
    const farmBefore = slice.reduce((sum, hour) => sum + scenarioOutput(hour, turbineId).baseline, 0);
    candidates.push({ startIndex, endIndex: startIndex + duration, startAt: slice[0].at,
      endAt: new Date(Date.parse(slice.at(-1)!.at) + 3_600_000).toISOString(), lost, farmBefore, farmAfter: farmBefore - lost });
  }
  candidates.sort((a, b) => a.lost - b.lost || a.startIndex - b.startIndex);
  const recommended = candidates[0];
  const alternative = candidates.find(candidate => candidate.startIndex >= recommended.endIndex || candidate.endIndex <= recommended.startIndex);
  return { turbineId, duration, candidateCount: candidates.length, recommended, alternative,
    avoidedLossPercent: alternative && alternative.lost > 0 ? (1 - recommended.lost / alternative.lost) * 100 : null };
}

const localDateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Find the exact local calendar day covered by an archived issue, end exclusive. */
export function localDayBounds(hours: ForecastHour[], localDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new RangeError('Invalid local date.');
  const indices = hours.flatMap((hour, index) => localDateFormat.format(new Date(hour.at)) === localDate ? [index] : []);
  if (!indices.length) throw new RangeError('Local day is absent from this forecast.');
  return { startIndex: indices[0], endIndex: indices.at(-1)! + 1 };
}

/** Apply a planned stop to a copy of forecast hours. Weather and other turbines stay as forecast. */
export function applyShutdown(hours: ForecastHour[], turbineId: string, startIndex: number, endIndex: number): ForecastHour[] {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex < 0 || startIndex >= endIndex || endIndex > hours.length) {
    throw new RangeError('Scenario window is outside the forecast.');
  }
  for (let index = startIndex; index < endIndex; index++) scenarioOutput(hours[index], turbineId);
  return hours.map((hour, index) => index < startIndex || index >= endIndex ? hour : {
    ...hour, readings: hour.readings.map(reading => reading.turbineId === turbineId ? { ...reading, power: 0 } : reading),
  });
}
