import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from './components/Icon';
import { MetricsPanel } from './components/MetricsPanel';
import { Timeline } from './components/Timeline';
import { AssistantBar } from './components/AssistantBar';
import { Settings, type DisplaySettings } from './components/Settings';
import { DEFAULT_DATE, fetchForecast, turbines as siteFallback, type ForecastDocument } from './forecast/forecast';
import { AnalyticsSection } from './analytics/AnalyticsSection';
import { environmentAt } from './forecast/environment';
import { TurbinesPage } from './turbines/TurbinesPage';
import { toggleSelection } from './turbines/tableModel';
import { useWindAt } from './scene/useWindAt';
import { OperationsPanel } from './operations/OperationsPanel';

const PlanetScene = lazy(() => import('./scene/PlanetScene'));
type Mode = 'historical' | 'live';
type View = 'overview' | 'turbines' | 'analytics' | 'operations';
const views: View[] = ['overview', 'turbines', 'analytics', 'operations'];

function viewFromHash(): View {
  const value = window.location.hash.slice(1);
  return views.includes(value as View) ? value as View : 'overview';
}

export default function App() {
  const [mode, setMode] = useState<Mode>('historical');
  const [date, setDate] = useState(DEFAULT_DATE);
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
    setError(null);
    setLoading(true);
    const issue = mode === 'historical' ? new Date(Date.parse(`${date}T00:00:00Z`) - 5 * 3600000).toISOString() : undefined;
    const start = mode === 'live' && liveDate ? new Date(Date.parse(`${liveDate}T00:00:00Z`) - 3600000).toISOString() : undefined;
    fetchForecast(mode, issue, start)
      .then(value => { if (active) setDocument(value); })
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
  useEffect(() => {
    const syncView = () => setView(viewFromHash());
    window.addEventListener('hashchange', syncView);
    window.addEventListener('popstate', syncView);
    return () => { window.removeEventListener('hashchange', syncView); window.removeEventListener('popstate', syncView); };
  }, []);
  useEffect(() => {
    if (view === 'analytics' && document) window.document.getElementById('analytics')?.scrollIntoView?.({ behavior: settings.motion ? 'smooth' : 'instant' });
  }, [view, settings.motion, document]);

  const current = document?.hours[hour];
  const environment = current ? environmentAt(current.at) : null;
  const focusTurbine = document?.turbines.find(turbine => turbine.id === selected[0]) ?? document?.turbines[0] ?? siteFallback[0];
  const focusReading = current?.readings.find(reading => reading.turbineId === focusTurbine.id);
  const runTime = mode === 'historical' ? document?.metadata.run_time_utc ?? '' : '';
  const wind = useWindAt(runTime, current?.at ?? '', {
    speed: focusReading?.windSpeed ?? 0, direction: focusReading?.direction ?? 0,
  }, focusTurbine.lat, focusTurbine.lon, Boolean(runTime && current && zoom > 3 && view !== 'turbines' && view !== 'operations'));

  function navigate(next: View) {
    setView(next); setInfoOpen(false); setSettingsOpen(false);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
  }
  function changeHorizon(value: 24 | 48) { setHorizon(value); setHour(currentHour => Math.min(currentHour, value - 1)); }
  const sourceNote = wind.source === 'api' ? 'Open-Meteo API · selected run'
    : wind.source === 'loading' ? 'Loading selected run · saved wind shown'
      : wind.error ? 'API unavailable · saved wind shown' : 'Saved agent forecast';

  return <main className="app-shell" data-time={environment?.timeOfDay} data-season={environment?.season} data-motion={settings.motion}>
    <header className="site-header">
      <a className="brand" href="./" aria-label="OnlyFriends home"><span className="brand-symbol"><i /><i /><i /></span>onlyfriends<span className="brand-dot">®</span></a>
      <nav className="view-tabs" aria-label="Main navigation">{views.map(next => <a key={next} href={`#${next}`} aria-current={view === next ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(next); }}>{next[0].toUpperCase() + next.slice(1)}</a>)}</nav>
      <button className="demo-indicator" aria-label="About this forecast" aria-expanded={infoOpen} onClick={() => setInfoOpen(value => !value)}><i /> {mode === 'historical' ? 'HISTORICAL REPLAY' : 'LIVE FORECAST'}</button>
    </header>
    {infoOpen && <section className="mission-card"><button className="icon-button small" aria-label="Close mission" onClick={() => setInfoOpen(false)}><Icon name="close" size={15} /></button><h2>Wind power forecast.</h2><p>Two turbines near Shelek. Weather feeds a trained power model through a traceable agent workflow. Power is normalized; February actual generation is unavailable.</p></section>}
    <div className="forecast-controls" aria-label="Forecast source"><label className="date-control"><span>Mode</span><select aria-label="Forecast mode" value={mode} onChange={event => { setDocument(null); setMode(event.target.value as Mode); }}><option value="historical">Historical replay</option><option value="live">Current forecast</option></select></label>
      {mode === 'historical' ? <label className="date-control"><span>Issue date</span><input type="date" aria-label="Issue date" value={date} min="2026-01-31" max="2026-02-28" onChange={event => { setDocument(null); setDate(event.target.value); }} /></label> : <label className="date-control"><span>Start date (UTC)</span><input type="date" aria-label="Live start date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} max={new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10)} value={liveDate} onChange={event => { setDocument(null); setLiveDate(event.target.value); }} /></label>}
      <button className="refresh-forecast" onClick={() => setRevision(value => value + 1)} disabled={loading} aria-label="Refresh forecast">Refresh</button>
      <span className="forecast-mode-note">{mode === 'historical' ? 'Daily replay · 31 Jan–28 Feb 2026' : 'Updated every 15 minutes while this page is visible'}</span>
    </div>
    {(loading || error) && <section className="forecast-status" role="status"><strong>{loading ? 'Loading forecast…' : 'Forecast unavailable'}</strong>{error && <p>{error}</p>}{error?.startsWith('MODEL_UNAVAILABLE') && <p>Configure the trained normalized-power model on the Python server, then refresh.</p>}</section>}
    {view === 'turbines' && document && current && <TurbinesPage hour={current} turbines={document.turbines} mode={mode} selected={selected} onSelection={setSelected} onView3D={() => navigate('overview')} />}
    {view === 'operations' && document && <OperationsPanel document={document} onHour={value => { setHour(value); setPlaying(false); navigate('overview'); }} />}
    {(view === 'overview' || view === 'analytics') && document && current && environment && <section className="world-section" aria-label="Interactive wind farm overview">
      <div className={`planet-stage ${zoom > 3.2 ? 'local' : ''}`}><Suspense fallback={<div className="scene-loading">Growing your little world…</div>}><PlanetScene hour={current} turbines={document.turbines} selected={selected} onSelect={id => setSelected(values => toggleSelection(values, id))} environment={environment} reset={reset} zoom={zoom} onZoom={setZoom} settings={settings} wind={wind} /></Suspense></div>
      <div className="hero-copy"><span className="eyebrow">Shelek · {mode === 'historical' ? 'February 2026' : 'Live forecast'}</span><h1>A closer look<br /><span>at the wind.</span></h1><div className="environment-label" aria-label="Scene environment"><Icon name={environment.timeOfDay === 'night' ? 'moon' : 'sun'} size={12} /><span>{environment.season} · {environment.timeOfDay}</span></div></div>
      <MetricsPanel hour={current} turbines={document.turbines} selected={selected} onSelect={setSelected} />
      <div className="scene-tools"><div className="zoom-presets" role="group" aria-label="Planet zoom presets">{[1, 2, 3, 4, 5].map(value => <button key={value} aria-pressed={Math.abs(zoom - value) < 0.015} onClick={() => setZoom(value)}>{value}×</button>)}</div><button className="icon-button" onClick={() => { setReset(value => value + 1); setZoom(1); }} aria-label="Reset planet view"><Icon name="reset" size={15} /></button><button className="icon-button" onClick={() => setSettingsOpen(value => !value)} aria-label="Display settings" aria-expanded={settingsOpen}><Icon name="settings" size={15} /></button></div>
      {zoom > 3.2 && <div className="wind-api-badge" role="status" aria-label="Wind effect data source"><Icon name="wind" size={17} /><div><strong>{wind.speed.toFixed(1)} m/s · {Math.round(wind.direction)}°</strong><span>{sourceNote}</span></div></div>}
      <div className={`drag-hint ${zoom > 3.2 ? 'local' : ''}`}>{zoom > 3.2 ? <>Drag or swipe to move <i /> Shift-drag to orbit <i /> Pinch to zoom</> : <>Drag to rotate <i /> Pinch or use zoom controls <i /> Swipe down for analytics</>}</div>
      {settingsOpen && <Settings value={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
      <div className="scene-stamp">{document.turbines.length} TURBINES · {mode.toUpperCase()}<span>Model {document.metadata.model_version} · saved run {document.metadata.run_id}</span></div>
    </section>}
    {document && current && <div className="bottom-section" id="forecast-section">
      <Timeline hours={document.hours} hour={hour} horizon={horizon} playing={playing} onHour={value => { setHour(value); setPlaying(false); }} onHorizon={changeHorizon} onPlay={() => setPlaying(value => !value)} />
      <div className="command-row"><AssistantBar key={`${document.metadata.run_id}-${hour}-${horizon}-${selected.join(',')}`} runId={document.metadata.run_id} selectedLeadHour={hour + 1} selectedTurbineId={selected.length === 1 ? selected[0] : null} horizon={horizon} selectedAt={current.at} />
        <span className="demo-note">{mode === 'historical' ? 'Archived agent run' : 'Live agent run'} · {document.turbines.length} turbines</span></div>
      <div className="provenance">Weather: {document.metadata.weather_source} · {document.metadata.run_time_utc ? `model initialization ${document.metadata.run_time_utc}` : `retrieved ${document.metadata.retrieved_at_utc}`} · Run {document.metadata.run_id} · Weather SHA256 {document.metadata.weather_sha256}{document.metadata.warnings?.map(warning => <p key={warning}>{warning}</p>)}</div>
    </div>}
    {document && (view === 'overview' || view === 'analytics') && <AnalyticsSection hours={document.hours} horizon={horizon} selected={selected} activeHour={hour} date={mode === 'historical' ? date : document.metadata.issue_time_utc.slice(0, 10)} mode={mode} turbines={document.turbines} weatherSource={document.metadata.weather_source} />}
    <footer>Predicted power is normalized, not MW or MWh.</footer>
  </main>;
}
