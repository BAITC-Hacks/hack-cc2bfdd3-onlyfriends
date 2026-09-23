import { useState } from 'react';
import { summarize, type ForecastHour } from '../forecast/forecast';
import { selectionForecast } from './tableModel';

export function SelectionSummary({ hour, selected }: { hour: ForecastHour; selected: string[] }) {
  const [mode, setMode] = useState<'aggregate' | 'individual'>('aggregate');
  const subset = selectionForecast(hour, selected);
  const metrics = summarize(subset);
  return <section className="selection-summary" aria-label="Selected turbine summary">
    <strong className="selection-count">{selected.length} selected</strong>
    {subset.readings.length === 0 ? <p className="summary-empty">Select turbines to compare their forecast.</p> : mode === 'aggregate' ? <div className="summary-values">
      <div><strong>{metrics.power.toFixed(2)} MW</strong><span>total power</span></div>
      <div><strong>{metrics.windSpeed.toFixed(1)} m/s</strong><span>avg wind</span></div>
      <div><strong>{metrics.temperature > 0 ? '+' : ''}{Math.round(metrics.temperature)}°C</strong><span>avg temperature</span></div>
    </div> : <div className="individual-values" tabIndex={0} aria-label="Individual selected forecasts">{subset.readings.map(reading => <div key={reading.turbineId}><strong>{reading.turbineId}</strong><span>{reading.power.toFixed(2)} MW</span><small>{reading.windSpeed.toFixed(1)} m/s · {Math.round(reading.temperature)}°C</small></div>)}</div>}
    <div className="summary-mode" role="group" aria-label="Summary mode">{(['aggregate', 'individual'] as const).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'aggregate' ? 'Aggregate' : 'Individual'}</button>)}</div>
  </section>;
}
