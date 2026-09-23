import { summarize, type ForecastDocument, type ForecastHour, type Turbine } from '../forecast/forecast';
import { Icon } from './Icon';

interface Props {
  hour: ForecastHour; hours: ForecastHour[]; turbines: Turbine[];
  metadata: ForecastDocument['metadata']; selected: string | null;
  onSelect: (id: string | null) => void;
}
export function MetricsPanel({ hour, hours, turbines, metadata, selected, onSelect }: Props) {
  const summary = summarize(hour);
  const reading = hour.readings.find(value => value.turbineId === selected);
  const turbine = turbines.find(value => value.id === selected);
  const power = reading?.power ?? summary.power;
  const series = hours.map(value => selected ? value.readings.find(item => item.turbineId === selected)!.power : summarize(value).power);
  const path = series.map((value, index) => `${index * 240 / 47},${48 - value * 42}`).join(' ');
  return <aside className="metrics-panel" aria-label="Forecast metrics">
    <div className="panel-heading"><span className="eyebrow">{turbine ? 'Turbine forecast' : 'Two-turbine forecast'}</span><span className="status-pill"><i /> SUCCESS</span></div>
    <div className="metric-title"><h2>{turbine?.name ?? 'Wind farm outlook'}</h2>{selected && <button className="icon-button small" onClick={() => onSelect(null)} aria-label="Show whole farm"><Icon name="close" size={15} /></button>}</div>
    <p className="muted">{turbine ? `${turbine.lat.toFixed(6)}, ${turbine.lon.toFixed(6)}` : 'Mean normalized line-side power'}</p>
    <div className="power-label"><Icon name="power" size={15} /> Predicted normalized power</div>
    <div className="power-value">{(power * 100).toFixed(1)}<span>%</span></div>
    <div className="capacity-label"><span>Model prediction</span><span>{metadata.mode === 'historical' ? 'Replay' : 'Live'}</span></div>
    <svg className="sparkline" viewBox="0 0 240 58" role="img" aria-label="48-hour normalized power forecast"><polyline points={path} fill="none" stroke="#317660" strokeWidth="2" strokeLinejoin="round" /></svg>
    <div className="metric-row"><span><Icon name="wind" /> Wind at 100 m</span><strong>{(reading?.windSpeed ?? summary.windSpeed).toFixed(1)} <small>m/s</small></strong></div>
    <div className="metric-row"><span><Icon name="temperature" /> Temperature</span><strong>{(reading?.temperature ?? summary.temperature).toFixed(1)}<small> °C</small></strong></div>
    <div className="metric-row"><span><Icon name="compass" /> Wind direction</span><strong>{reading ? `${reading.direction.toFixed(0)}°` : 'Select turbine'}</strong></div>
    {reading && <div className="metric-row"><span>Pressure</span><strong>{reading.pressure.toFixed(0)} <small>hPa</small></strong></div>}
    <div className="confidence"><Icon name="sparkles" size={15} /><span>Weather: {metadata.weather_model}</span><strong>{metadata.mode}</strong></div>
    <div className="turbine-selector"><label htmlFor="turbine-select">Explore a turbine</label><select id="turbine-select" value={selected ?? ''} onChange={event => onSelect(event.target.value || null)}><option value="">Both turbines</option>{turbines.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></div>
  </aside>;
}
