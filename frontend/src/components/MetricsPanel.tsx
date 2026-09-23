import { forecast, summarize, turbines, type ForecastHour } from '../forecast/forecast';
import { Icon } from './Icon';

interface Props { hour: ForecastHour; selected: string | null; onSelect: (id: string | null) => void }
export function MetricsPanel({ hour, selected, onSelect }: Props) {
  const summary = summarize(hour);
  const reading = hour.readings.find(r => r.turbineId === selected);
  const turbine = turbines.find(t => t.id === selected);
  const power = reading?.power ?? summary.power;
  const capacity = reading ? 3.6 : turbines.length * 3.6;
  const series = forecast.map(h => selected ? h.readings.find(r => r.turbineId === selected)!.power : summarize(h).power);
  const path = series.map((v, i) => `${i * 240 / 47},${48 - v / capacity * 42}`).join(' ');
  return <aside className="metrics-panel" aria-label="Forecast metrics">
    <div className="panel-heading"><span className="eyebrow">{turbine ? 'Turbine insight' : 'Farm overview'}</span><span className="status-pill"><i /> All systems ready</span></div>
    <div className="metric-title"><h2>{turbine?.name ?? 'A brighter outlook.'}</h2>{selected && <button className="icon-button small" onClick={() => onSelect(null)} aria-label="Show whole farm"><Icon name="close" size={15} /></button>}</div>
    <p className="muted">{turbine ? `${turbine.region} · 3.6 MW capacity` : 'Your wind. Working smarter.'}</p>
    <div className="power-label"><Icon name="power" size={15} /> Predicted output</div>
    <div className="power-value">{power.toFixed(1)}<span>MW</span></div>
    <div className="capacity-label"><span>{Math.round(power / capacity * 100)}% of capacity</span><span>Forecast</span></div>
    <svg className="sparkline" viewBox="0 0 240 58" role="img" aria-label="48-hour power forecast"><defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#64a18a" stopOpacity=".22" /><stop offset="100%" stopColor="#64a18a" stopOpacity="0" /></linearGradient></defs><polygon points={`0,58 ${path} 240,58`} fill="url(#spark-fill)" /><polyline points={path} fill="none" stroke="#317660" strokeWidth="2" strokeLinejoin="round" /></svg>
    <div className="metric-row"><span><Icon name="wind" /> Wind speed</span><strong>{(reading?.windSpeed ?? summary.windSpeed).toFixed(1)} <small>m/s</small></strong></div>
    <div className="metric-row"><span><Icon name="temperature" /> Temperature</span><strong>{Math.round(reading?.temperature ?? summary.temperature)}<small> °C</small></strong></div>
    <div className="metric-row"><span><Icon name="compass" /> Wind direction</span><strong>{reading?.direction ?? summary.direction}° <small>NE</small></strong></div>
    <div className="confidence"><Icon name="sparkles" size={15} /><span>Illustrative forecast confidence</span><strong>94%</strong></div>
    <div className="turbine-selector"><label htmlFor="turbine-select">Explore a turbine</label><select id="turbine-select" value={selected ?? ''} onChange={e => onSelect(e.target.value || null)}><option value="">All {turbines.length} turbines</option>{turbines.map(t => <option key={t.id} value={t.id}>{t.name} · {t.region}</option>)}</select></div>
  </aside>;
}
