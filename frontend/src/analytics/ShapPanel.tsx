import { useEffect, useState } from 'react';
import shap from '../data/february2026-shap.json';
import { hourLabel, turbines, type ForecastHour } from '../forecast/forecast';

const featureLabels: Record<string, string> = {
  turbine_id: 'Turbine', lead_hour: 'Forecast lead time', wind_speed_10m: 'Wind at 10 m',
  wind_speed_100m: 'Wind at 100 m', temperature_2m: 'Air temperature', surface_pressure: 'Air pressure',
  direction_sin: 'Wind direction · sine', direction_cos: 'Wind direction · cosine',
  wind_shear: 'Wind shear', hour_sin: 'Hour · sine', hour_cos: 'Hour · cosine',
  doy_sin: 'Day of year · sine', doy_cos: 'Day of year · cosine',
  wind_u100: 'East–west wind at 100 m', wind_v100: 'North–south wind at 100 m',
  wind_shear_delta: 'Wind shear difference', run_age_hours: 'Weather run age',
  run_lead_hours: 'Weather lead time', wind_100m_lag_3h: 'Wind 3 h earlier',
  wind_100m_lag_1h: 'Wind 1 h earlier', wind_100m_lead_1h: 'Wind 1 h later',
  wind_100m_lead_3h: 'Wind 3 h later', wind_100m_slope_2h: 'Wind trend over 2 h',
  air_density_proxy: 'Air density estimate', density_adjusted_wind: 'Density adjusted wind',
};

export function ShapPanel({ date, hour, selected, scenarioTurbineId }: {
  date: string; hour: ForecastHour; selected: string[]; scenarioTurbineId?: string | null;
}) {
  const [turbineId, setTurbineId] = useState(selected[0] ?? turbines[0].id);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { if (selected.length === 1) setTurbineId(selected[0]); }, [selected]);
  const issue = shap.issues.find(item => item.date === date);
  const sourceHour = issue?.hours.find(item => item.at === hour.at);
  const reading = sourceHour?.readings.find(item => item.turbineId === turbineId);
  const forecast = hour.readings.find(item => item.turbineId === turbineId);
  if (!issue || !reading || !forecast) return <article className="shap-panel"><h3>Why this forecast?</h3><p>Model explanation unavailable for this issue and hour.</p></article>;
  const features = shap.featureNames.map((name, index) => ({ name, value: reading.contributions[index] }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const visible = showAll ? features : features.slice(0, 8);
  const maxImpact = Math.max(...features.map(item => Math.abs(item.value)), 0.001);
  const savedPower = Math.min(1, Math.max(0, reading.rawPrediction));
  return <article className="shap-panel" aria-label="SHAP model explanation">
    <div className="shap-heading"><div><span className="eyebrow">Model explanation · {hourLabel(hour.at, true)} UTC+5</span><h3>Why this forecast?</h3><p>SHAP contribution to this turbine’s raw CatBoost output. Positive raises it; negative lowers it.</p></div><label>Explain turbine<select aria-label="Explain turbine" value={turbineId} onChange={event => setTurbineId(event.target.value)}>{turbines.map(turbine => <option key={turbine.id} value={turbine.id}>{turbine.name}</option>)}</select></label></div>
    <div className="shap-equation"><div><span>Model baseline</span><strong>{reading.baseValue.toFixed(3)}</strong></div><span className="shap-plus">+</span><div><span>Feature impacts</span><strong>{(reading.rawPrediction - reading.baseValue >= 0 ? '+' : '') + (reading.rawPrediction - reading.baseValue).toFixed(3)}</strong></div><span className="shap-plus">=</span><div><span>Raw output</span><strong>{reading.rawPrediction.toFixed(3)}</strong></div><div><span>Displayed forecast</span><strong>{savedPower.toFixed(3)} <small>/ 1.0</small></strong></div></div>
    <ul className="shap-features">{visible.map(feature => <li key={feature.name}><span className="shap-feature-name">{featureLabels[feature.name] ?? feature.name.replaceAll('_', ' ')}</span><span className="shap-track"><i style={{ width: `${Math.max(2, Math.abs(feature.value) / maxImpact * 100)}%` }} data-sign={feature.value >= 0 ? 'positive' : 'negative'} /></span><strong data-sign={feature.value >= 0 ? 'positive' : 'negative'}>{feature.value >= 0 ? '+' : ''}{feature.value.toFixed(3)}</strong></li>)}</ul>
    <button className="shap-toggle" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show top 8 features' : `Show all ${features.length} features`}</button>
    <p className="shap-note">Model {issue.modelVersion} · archived weather for this issue. The displayed forecast clips raw output to 0–1. SHAP distributes model output across inputs; correlated weather features can share impact. It does not prove cause or explain a simulated turbine stop.{scenarioTurbineId && ' This panel shows the original model forecast, before the what-if shutdown.'}</p>
  </article>;
}
