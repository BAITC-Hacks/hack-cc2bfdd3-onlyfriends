import { summarize, type ForecastHour, type Turbine } from '../forecast/forecast';
import { Icon } from './Icon';
import { selectionForecast } from '../turbines/tableModel';

interface Props { hour: ForecastHour; turbines: Turbine[]; selected: string[]; onSelect: (ids: string[]) => void }
export function MetricsPanel({ hour, turbines, selected, onSelect }: Props) {
  const summary = summarize(selected.length ? selectionForecast(hour, selected) : hour);
  const reading = selected.length === 1 ? hour.readings.find(r => r.turbineId === selected[0]) : undefined;
  const turbine = selected.length === 1 ? turbines.find(t => t.id === selected[0]) : undefined;
  return <>
    <aside className="metrics-strip" aria-label="Forecast metrics">
      <div><span>{selected.length ? `${selected.length} selected · Mean normalized power` : 'Mean normalized power'}</span><strong data-testid="forecast-power">{summary.power.toFixed(3)}<small> / 1</small></strong></div>
      <div><span>Wind at 100 m</span><strong>{summary.windSpeed.toFixed(1)}<small>m/s</small></strong></div>
      <div><span>Air</span><strong>{Math.round(summary.temperature)}<small>°C</small></strong></div>
    </aside>
    {reading && turbine && <aside className="turbine-insight" aria-label="Turbine insight">
      <div className="panel-heading"><span className="eyebrow">Turbine insight</span><button className="icon-button small" onClick={() => onSelect([])} aria-label="Show whole farm"><Icon name="close" size={13} /></button></div>
      <h2>{turbine.name}</h2>
      <div className="insight-values"><strong>{reading.power.toFixed(3)}<small> / 1</small></strong><span><Icon name="wind" size={12} />{reading.windSpeed.toFixed(1)} m/s</span></div>
      <p>{Math.round(reading.power * 100)}% normalized · {Math.round(reading.temperature)}°C · {reading.direction}°</p>
    </aside>}
    <div className="turbine-selector"><label className="sr-only" htmlFor="turbine-select">Explore a turbine</label><select id="turbine-select" value={selected.length > 1 ? 'multiple' : selected[0] ?? ''} onChange={e => onSelect(e.target.value ? [e.target.value] : [])}><option value="">All {turbines.length} turbines</option>{selected.length > 1 && <option value="multiple" disabled>{selected.length} selected</option>}{turbines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
  </>;
}
