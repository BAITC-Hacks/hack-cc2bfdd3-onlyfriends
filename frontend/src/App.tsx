import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from './components/Icon';
import { MetricsPanel } from './components/MetricsPanel';
import { Timeline } from './components/Timeline';
import { AssistantBar } from './components/AssistantBar';
import { Settings, type DisplaySettings } from './components/Settings';
import { fetchForecast, hourLabel, type ForecastDocument } from './forecast/forecast';
import { environmentAt } from './forecast/environment';
import { TurbinesPage } from './turbines/TurbinesPage';
import { toggleSelection } from './turbines/tableModel';
import { OperationsPanel } from './operations/OperationsPanel';

const PlanetScene = lazy(() => import('./scene/PlanetScene'));
type Mode = 'historical' | 'live';
type View = 'overview' | 'turbines' | 'operations';
function viewFromHash(): View { return window.location.hash === '#turbines' ? 'turbines' : window.location.hash === '#operations' ? 'operations' : 'overview'; }
export default function App() {
  const [mode, setMode] = useState<Mode>('live');
  const [date, setDate] = useState('2026-01-31');
  const [liveDate, setLiveDate] = useState('');
  const [revision, setRevision] = useState(0);
  const [document, setDocument] = useState<ForecastDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hour, setHour] = useState(0);
  const [horizon, setHorizon] = useState<24 | 48>(48);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<View>(viewFromHash);
  const [zoom, setZoom] = useState(1);
  const [reset, setReset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settings, setSettings] = useState<DisplaySettings>({ weather: true, motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, suppliedModel: false });

  useEffect(() => {
    let active = true;
    setError(null); setLoading(true);
    const issue = mode === 'historical' ? new Date(Date.parse(`${date}T00:00:00Z`) - 5 * 3600000).toISOString() : undefined;
    const start = mode === 'live' && liveDate ? new Date(Date.parse(`${liveDate}T00:00:00Z`) - 3600000).toISOString() : undefined;
    fetchForecast(mode, issue, start).then(value => { if (active) setDocument(value); })
      .catch(reason => { if (active) { setDocument(null); setError(reason instanceof Error ? reason.message : 'Forecast request failed.'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, date, liveDate, revision]);
  useEffect(() => { setPlaying(false); setHour(0); setSelected([]); }, [mode, date, liveDate]);
  useEffect(() => {
    if (mode !== 'live') return;
    const timer = window.setInterval(() => { if (window.document.visibilityState === 'visible') setRevision(value => value + 1); }, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [mode]);
  useEffect(() => {
    if (!playing || !document) return;
    const timer = window.setInterval(() => setHour(value => (value + 1) % horizon), 1200);
    return () => window.clearInterval(timer);
  }, [playing, horizon, document]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSettings(value => ({ ...value, motion: !media.matches }));
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const current = document?.hours[hour];
  const environment = current ? environmentAt(current.at) : null;
  useEffect(() => {
    const syncView = () => setView(viewFromHash());
    window.addEventListener('hashchange', syncView);
    window.addEventListener('popstate', syncView);
    return () => { window.removeEventListener('hashchange', syncView); window.removeEventListener('popstate', syncView); };
  }, []);
  function navigate(next: View) {
    setView(next); setInfoOpen(false); setSettingsOpen(false);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
  }
  function changeHorizon(value: 24 | 48) { setHorizon(value); setHour(currentHour => Math.min(currentHour, value - 1)); }

  return <main className="app-shell" data-time={environment?.timeOfDay} data-season={environment?.season} data-motion={settings.motion}>
    <header className="site-header"><a className="brand" href="./" aria-label="OnlyFriends home"><span className="brand-symbol"><i /><i /><i /></span>onlyfriends<span className="brand-dot">®</span></a><nav className="view-tabs" aria-label="Main navigation">{(['overview', 'turbines', 'operations'] as const).map(next => <a key={next} href={`#${next}`} aria-current={view === next ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(next); }}>{next === 'overview' ? 'Overview' : next === 'turbines' ? 'Turbines' : 'Operations'}</a>)}</nav><div className="header-right"><span className="demo-indicator"><i /> {mode === 'historical' ? 'HISTORICAL REPLAY' : 'LIVE FORECAST'}</span><button className="avatar" aria-label="Open display settings" onClick={() => setSettingsOpen(value => !value)}>OF</button></div></header>
    {infoOpen && <section className="mission-card"><button className="icon-button small" aria-label="Close mission" onClick={() => setInfoOpen(false)}><Icon name="close" /></button><span className="eyebrow">Wind power forecasting</span><h2>Two turbines. One traceable forecast.</h2><p>Weather forecasts feed a trained power model through a validated agent workflow. Historical replay and current forecasts use separate weather endpoints.</p></section>}
    <div className="forecast-controls" aria-label="Forecast source">
      <label>Mode <select aria-label="Forecast mode" value={mode} onChange={event => { setDocument(null); setMode(event.target.value as Mode); }}><option value="live">Current and future forecast</option><option value="historical">Hackathon replay · Jan–Feb 2026</option></select></label>
      {mode === 'historical' && <label>Issue date (00:00 UTC+5) <input aria-label="Issue date" type="date" min="2026-01-31" max="2026-02-28" value={date} onChange={event => { setDocument(null); setDate(event.target.value); }} /></label>}
      {mode === 'live' && <label>Start date (UTC) <input aria-label="Live start date" type="date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} max={new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10)} value={liveDate} onChange={event => { setDocument(null); setLiveDate(event.target.value); }} /></label>}
      <button onClick={() => setRevision(value => value + 1)} disabled={loading} aria-label="Refresh forecast">Refresh forecast</button>
      <span className="forecast-mode-note">{mode === 'live' ? 'Next 48 hours by default. While this page is open, the agent checks for updated weather every 15 minutes and compares overlapping forecasts.' : 'Replay is limited to the 31 January–28 February 2026 hackathon issues.'}</span>
    </div>
    {(loading || error) && <section className="forecast-status" role="status"><strong>{loading ? 'Loading forecast…' : 'Forecast unavailable'}</strong>{error && <p>{error}</p>}{error?.startsWith('MODEL_UNAVAILABLE') && <p>Configure a trained normalized-power model on the Python server, then refresh. No power values are shown until the model runs.</p>}</section>}
    {view === 'turbines' && document && current && <TurbinesPage hour={current} turbines={document.turbines} selected={selected} onSelection={setSelected} onView3D={() => navigate('overview')} />}
    {view === 'operations' && document && <OperationsPanel document={document} onHour={value => { setHour(value); setPlaying(false); navigate('overview'); }} />}
    {view === 'overview' && <section className="world-section" aria-label="Interactive wind farm overview">
      <div className="hero-copy"><div className="location-tag"><span className="location-dot" /> SHELEK, KAZAKHSTAN<Icon name="diagonal" size={12} /></div><h1>Small planet.<br /><span>Big potential.</span></h1><p>Hourly weather and normalized power,<br />from a recorded forecast run.</p><div className="hero-meta"><span className="leaf-badge"><Icon name="leaf" size={17} /></span><span>Two mapped turbines.<br /><strong>Weather linked to model output.</strong></span></div></div>
      {document && current && environment && <><div className="planet-stage"><div className="planet-halo" /><Suspense fallback={<div className="scene-loading"><span />Loading planet…</div>}><PlanetScene hour={current} turbines={document.turbines} selected={selected} onSelect={id => setSelected(values => toggleSelection(values, id))} environment={environment} zoom={zoom} onZoom={setZoom} reset={reset} settings={settings} /></Suspense></div>
        <div className="orbit-caption"><span className="mini-line" /> FORECASTED WIND FARM</div>
        <MetricsPanel hour={current} hours={document.hours} turbines={document.turbines} metadata={document.metadata} selected={selected.length === 1 ? selected[0] : null} onSelect={id => setSelected(id ? [id] : [])} />
        <div className="scene-tools"><div className="zoom-toggle" aria-label="Planet zoom">{[1, 2, 3, 4, 5].map(value => <button key={value} aria-pressed={Math.abs(zoom - value) < 0.015} onClick={() => setZoom(value)}>{value}×</button>)}</div><button className="icon-button" onClick={() => { setReset(value => value + 1); setZoom(1); }} aria-label="Reset planet view"><Icon name="reset" size={16} /></button><button className="icon-button" onClick={() => setSettingsOpen(value => !value)} aria-label="Display settings" aria-expanded={settingsOpen}><Icon name="settings" size={16} /></button></div>
        <div className="drag-hint"><Icon name="globe" size={14} /><span>Drag to explore</span><i />Select a turbine</div>
        {settingsOpen && <Settings value={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
        <div className="scene-stamp"><span className="status-dot" /> {document.turbines.length} TURBINES · {document.metadata.mode.toUpperCase()}<span>Model {document.metadata.model_version} · points spaced visually for clarity</span></div></>}
    </section>}
    {document && current && <div className="bottom-section" id="forecast-section"><div className="forecast-date"><span><Icon name="weather" size={17} />{hourLabel(current.at, true)}<small>UTC+5</small></span><span>Forecast origin {new Date(document.metadata.issue_time_utc).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC</span></div><Timeline hours={document.hours} hour={hour} horizon={horizon} playing={playing} onHour={value => { setHour(value); setPlaying(false); }} onHorizon={changeHorizon} onPlay={() => setPlaying(value => !value)} /><AssistantBar key={`${document.metadata.run_id}-${hour}-${horizon}-${selected.join(',')}`} runId={document.metadata.run_id} selectedLeadHour={hour + 1} selectedTurbineId={selected.length === 1 ? selected[0] : null} horizon={horizon} selectedAt={current.at} /><div className="provenance">Weather: {document.metadata.weather_source} · {document.metadata.run_time_utc ? `model initialization ${document.metadata.run_time_utc}` : `retrieved ${document.metadata.retrieved_at_utc}`} · Run {document.metadata.run_id} · Weather SHA256 {document.metadata.weather_sha256}{document.metadata.warnings?.map(warning => <p key={warning}>{warning}</p>)}</div></div>}
    <footer><span>BETTER TOGETHER. BETTER FOR THE PLANET.</span><span>Power values are normalized, not MW or MWh<Icon name="leaf" size={13} /></span></footer>
  </main>;
}
