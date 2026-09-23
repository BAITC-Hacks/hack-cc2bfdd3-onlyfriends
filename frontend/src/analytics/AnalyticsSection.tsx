import { useState } from 'react';
import { hourLabel, monthForecast, summarize, type ForecastHour, type Turbine } from '../forecast/forecast';
import './analytics.css';

type Metric = 'power' | 'windSpeed' | 'windSpeed10' | 'direction' | 'temperature' | 'pressure';
const plots: { key: Metric; title: string; unit: string; color: string }[] = [
  { key: 'power', title: 'Mean normalized power', unit: 'of 1.0', color: '#6f9c77' },
  { key: 'windSpeed', title: 'Wind at 100 m', unit: 'm/s', color: '#75afc1' },
  { key: 'windSpeed10', title: 'Wind at 10 m', unit: 'm/s', color: '#9abcb9' },
  { key: 'direction', title: 'Wind direction', unit: '°', color: '#c7a877' },
  { key: 'temperature', title: 'Air temperature', unit: '°C', color: '#c28a82' },
  { key: 'pressure', title: 'Surface pressure', unit: 'hPa', color: '#9b94b9' },
];

function values(hours: ForecastHour[], key: Metric, selected: string[]): number[] {
  return hours.map(hour => {
    const readings = selected.length ? hour.readings.filter(reading => selected.includes(reading.turbineId)) : hour.readings;
    const summary = summarize({ ...hour, readings });
    return summary[key];
  });
}

function TrendChart({ hours, metric, selected, highlighted }: { hours: ForecastHour[]; metric: typeof plots[number]; selected: string[]; highlighted?: string }) {
  const series = values(hours, metric.key, selected);
  const min = Math.min(...series), max = Math.max(...series);
  const range = Math.max(max - min, 0.001);
  const points = series.map((value, index) => `${(index / Math.max(1, series.length - 1) * 600).toFixed(1)},${(106 - (value - min) / range * 86).toFixed(1)}`);
  const mark = highlighted ? hours.findIndex(hour => hour.at === highlighted) : -1;
  const average = series.reduce((sum, value) => sum + value, 0) / series.length;
  return <article className="trend-card">
    <div className="trend-heading"><div><span className="eyebrow">Forecast series</span><h3>{metric.title}</h3></div><strong>{average.toFixed(metric.key === 'direction' ? 0 : 2)} <small>{metric.unit} avg</small></strong></div>
    <svg viewBox="0 0 600 132" role="img" aria-label={`${metric.title}: ${series.length} hourly forecast values, minimum ${min.toFixed(1)}, maximum ${max.toFixed(1)} ${metric.unit}`} preserveAspectRatio="none">
      <line x1="0" y1="106" x2="600" y2="106" stroke="currentColor" opacity="0.16" />
      <line x1="0" y1="63" x2="600" y2="63" stroke="currentColor" opacity="0.10" />
      <polyline fill="none" stroke={metric.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" points={points.join(' ')} />
      {mark >= 0 && <circle cx={mark / Math.max(1, hours.length - 1) * 600} cy={106 - (series[mark] - min) / range * 86} r="5" fill={metric.color} stroke="white" strokeWidth="2" />}
    </svg>
    <div className="chart-axis"><span>{hourLabel(hours[0].at, true)}</span><span>{min.toFixed(1)}–{max.toFixed(1)} {metric.unit}</span><span>{hourLabel(hours.at(-1)!.at, true)}</span></div>
  </article>;
}

export function AnalyticsSection({ hours, horizon, selected, activeHour, date, mode, turbines, weatherSource }: { hours: ForecastHour[]; horizon: 24 | 48; selected: string[]; activeHour: number; date: string; mode: 'historical' | 'live'; turbines: Turbine[]; weatherSource: string }) {
  const [period, setPeriod] = useState<'issue' | 'month'>('issue');
  const currentPeriod = mode === 'live' ? 'issue' : period;
  const visible = currentPeriod === 'month' ? monthForecast : hours.slice(0, horizon);
  const powers = values(visible, 'power', selected);
  const winds = values(visible, 'windSpeed', selected);
  const peakIndex = powers.indexOf(Math.max(...powers));
  const scope = selected.length === 1 ? turbines.find(t => t.id === selected[0])?.name : 'Two-turbine farm';
  return <section className="analytics-section" id="analytics" aria-labelledby="analytics-title">
    <div className="analytics-heading"><div><span className="eyebrow">Forecast intelligence · {mode === 'historical' ? 'February 2026' : 'current run'}</span><h2 id="analytics-title">The story behind the wind.</h2><p>{scope} · {currentPeriod === 'month' ? 'archived month snapshot' : weatherSource} · Almaty time (UTC+5)</p></div>{mode === 'historical' && <div className="analytics-switch" role="group" aria-label="Analytics period"><button aria-pressed={period === 'issue'} onClick={() => setPeriod('issue')}>{horizon}h issue</button><button aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Full February</button></div>}</div>
    <div className="analytics-cards">
      <div><span>Forecast coverage</span><strong>{visible.length}<small> hours</small></strong><p>{currentPeriod === 'month' ? '1–28 Feb · every local hour' : `${date} run · next ${horizon} hours`}</p></div>
      <div><span>Average normalized output</span><strong>{(powers.reduce((sum, value) => sum + value, 0) / powers.length).toFixed(3)}<small> / 1.0</small></strong><p>Mean of selected turbine forecasts</p></div>
      <div><span>Peak predicted output</span><strong>{powers[peakIndex].toFixed(3)}<small> / 1.0</small></strong><p>{hourLabel(visible[peakIndex].at, true)} · UTC+5</p></div>
      <div><span>Average wind at 100 m</span><strong>{(winds.reduce((sum, value) => sum + value, 0) / winds.length).toFixed(1)}<small> m/s</small></strong><p>Archived weather input</p></div>
    </div>
    <div className="analytics-grid">{plots.map(plot => <TrendChart key={plot.key} hours={visible} metric={plot} selected={selected} highlighted={currentPeriod === 'issue' ? hours[activeHour].at : undefined} />)}</div>
    <div className="analytics-detail"><div><span className="eyebrow">Hourly detail</span><h3>{currentPeriod === 'month' ? 'February forecast archive snapshot' : `${horizon}-hour run · ${date}`}</h3></div><div className="analytics-table-wrap" role="region" tabIndex={0} aria-label="Hourly forecast readings"><table><thead><tr><th>Local time</th><th>Mean normalized power</th><th>Δ previous hour</th><th>Δ 24 hours</th><th>Wind 100 m</th><th>Wind 10 m</th><th>Direction</th><th>Air</th><th>Pressure</th></tr></thead><tbody>{visible.map((hour, index) => {
      const readings = selected.length ? hour.readings.filter(reading => selected.includes(reading.turbineId)) : hour.readings;
      const row = summarize({ ...hour, readings });
      const change = (lag: number) => index < lag ? '—' : `${(row.power - powers[index - lag]) >= 0 ? '+' : ''}${(row.power - powers[index - lag]).toFixed(3)}`;
      return <tr key={hour.at} data-active={currentPeriod === 'issue' && hour.at === hours[activeHour].at}><td><time dateTime={hour.at}>{hourLabel(hour.at, true)}</time></td><td>{row.power.toFixed(3)}</td><td>{change(1)}</td><td>{change(24)}</td><td>{row.windSpeed.toFixed(1)} m/s</td><td>{row.windSpeed10.toFixed(1)} m/s</td><td>{row.direction}°</td><td>{row.temperature.toFixed(1)} °C</td><td>{row.pressure.toFixed(1)} hPa</td></tr>;
    })}</tbody></table></div></div>
    <p className="analytics-source">Power is the mean normalized forecast of the selected turbines (0–1), not MW. February actual generation is unavailable, so accuracy is not shown. {currentPeriod === 'month' ? 'The month view is a bundled historical snapshot; the issue view comes from the saved agent run.' : `Weather: ${weatherSource}.`} Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Mapzen / AWS Open Data</a>; water features © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.</p>
  </section>;
}
