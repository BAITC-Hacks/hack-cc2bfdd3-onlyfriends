import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Icon } from './components/Icon';
import { MetricsPanel } from './components/MetricsPanel';
import { Timeline } from './components/Timeline';
import { AssistantBar } from './components/AssistantBar';
import { Settings, type DisplaySettings } from './components/Settings';
import { availableDates, createForecast, DEFAULT_DATE, issueRunTime, turbines } from './forecast/forecast';
import { AnalyticsSection } from './analytics/AnalyticsSection';
import { environmentAt } from './forecast/environment';
import { TurbinesPage } from './turbines/TurbinesPage';
import { toggleSelection } from './turbines/tableModel';
import { useWindAt } from './scene/useWindAt';

const PlanetScene = lazy(() => import('./scene/PlanetScene'));
export default function App() {
  const [date, setDate] = useState(DEFAULT_DATE);
  const [hour, setHour] = useState(0);
  const [horizon, setHorizon] = useState<24 | 48>(48);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<'overview' | 'turbines' | 'analytics'>(() => window.location.hash === '#turbines' ? 'turbines' : window.location.hash === '#analytics' ? 'analytics' : 'overview');
  const [zoom, setZoom] = useState(1);
  const [reset, setReset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settings, setSettings] = useState<DisplaySettings>({ weather: true, motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, suppliedModel: false });
  const forecast = useMemo(() => createForecast(date), [date]);
  const environment = useMemo(() => environmentAt(forecast[hour].at), [forecast, hour]);
  const focusTurbine = turbines.find(turbine => turbine.id === selected[0]) ?? turbines[0];
  const focusReading = forecast[hour].readings.find(reading => reading.turbineId === focusTurbine.id)!;
  const wind = useWindAt(issueRunTime(date), forecast[hour].at,
    { speed: focusReading.windSpeed100, direction: focusReading.direction },
    focusTurbine.lat, focusTurbine.lon, zoom > 3 && view !== 'turbines');
  useEffect(() => {
    const syncView = () => setView(window.location.hash === '#turbines' ? 'turbines' : window.location.hash === '#analytics' ? 'analytics' : 'overview');
    window.addEventListener('hashchange', syncView);
    window.addEventListener('popstate', syncView);
    return () => { window.removeEventListener('hashchange', syncView); window.removeEventListener('popstate', syncView); };
  }, []);
  useEffect(() => {
    if (view === 'analytics') document.getElementById('analytics')?.scrollIntoView?.({ behavior: settings.motion ? 'smooth' : 'instant' });
  }, [view, settings.motion]);
  function navigate(next: 'overview' | 'turbines') {
    setView(next); setInfoOpen(false); setSettingsOpen(false);
    if (window.location.hash !== `#${next}`) window.history.pushState(null, '', `#${next}`);
  }
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setHour(value => (value + 1) % horizon), 1200);
    return () => window.clearInterval(timer);
  }, [playing, horizon]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setSettings(value => ({ ...value, motion: !media.matches }));
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  function changeHorizon(value: 24 | 48) { setHorizon(value); setHour(current => Math.min(current, value - 1)); }
  return <main className="app-shell" data-time={environment.timeOfDay} data-season={environment.season} data-motion={settings.motion}>
    <header className="site-header">
      <a className="brand" href="./" aria-label="OnlyFriends home"><span className="brand-symbol"><i /><i /><i /></span>onlyfriends<span className="brand-dot">®</span></a>
      <nav className="view-tabs" aria-label="Main navigation">{(['overview', 'turbines'] as const).map(next => <a key={next} href={`#${next}`} aria-current={view === next ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(next); }}>{next === 'overview' ? 'Overview' : 'Turbines'}</a>)}<a href="#analytics" aria-current={view === 'analytics' ? 'page' : undefined} onClick={event => { event.preventDefault(); setView('analytics'); window.history.pushState(null, '', '#analytics'); }}>Analytics</a></nav>
      <button className="demo-indicator" aria-label="About this demo" aria-expanded={infoOpen} onClick={() => setInfoOpen(v => !v)}><i /> DEMO</button>
    </header>
    {infoOpen && <section className="mission-card"><button className="icon-button small" aria-label="Close mission" onClick={() => setInfoOpen(false)}><Icon name="close" size={15} /></button><h2>February wind forecast.</h2><p>Two turbines near Shelek. Archived hourly forecasts cover 1–28 February 2026. Power is normalized; actual production data is not available.</p></section>}
    {view === 'turbines' ? <TurbinesPage hour={forecast[hour]} selected={selected} onSelection={setSelected} onView3D={() => navigate('overview')} /> : <section className="world-section" aria-label="Interactive wind farm overview">
      <div className={`planet-stage ${zoom > 3.2 ? 'local' : ''}`}><Suspense fallback={<div className="scene-loading">Growing your little world…</div>}><PlanetScene hour={forecast[hour]} selected={selected} onSelect={id => setSelected(current => toggleSelection(current, id))} environment={environment} reset={reset} zoom={zoom} onZoom={setZoom} settings={settings} wind={wind} /></Suspense></div>
      <div className="hero-copy"><span className="eyebrow">Shelek · February 2026</span><h1>A closer look<br /><span>at the wind.</span></h1><div className="environment-label" aria-label="Scene environment"><Icon name={environment.timeOfDay === 'night' ? 'moon' : 'sun'} size={12} /><span>{environment.season} · {environment.timeOfDay}</span></div></div>
      <MetricsPanel hour={forecast[hour]} selected={selected} onSelect={setSelected} />
      <div className="scene-tools"><div className="zoom-presets" role="group" aria-label="Planet zoom presets">{[1, 2, 3, 4, 5].map(value => <button key={value} aria-pressed={Math.abs(zoom - value) < 0.015} onClick={() => setZoom(value)}>{value}×</button>)}</div><button className="icon-button" onClick={() => { setReset(v => v + 1); setZoom(1); }} aria-label="Reset planet view"><Icon name="reset" size={15} /></button><button className="icon-button" onClick={() => setSettingsOpen(v => !v)} aria-label="Display settings" aria-expanded={settingsOpen}><Icon name="settings" size={15} /></button></div>
      {zoom > 3.2 && <div className="wind-api-badge" role="status" aria-label="Wind effect data source"><Icon name="wind" size={17} /><div><strong>{wind.speed.toFixed(1)} m/s · {Math.round(wind.direction)}°</strong><span>{wind.source === 'api' ? 'Open-Meteo API · selected run' : wind.source === 'loading' ? 'Loading API · archived wind shown' : 'API unavailable · archived wind shown'}</span></div></div>}
      <div className={`drag-hint ${zoom > 3.2 ? 'local' : ''}`}>{zoom > 3.2 ? <>Drag or swipe to move <i /> Shift-drag to orbit <i /> Pinch to zoom</> : <>Drag to rotate <i /> Pinch or use zoom controls <i /> Swipe down for analytics</>}</div>
      {settingsOpen && <Settings value={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
    </section>}
    <div className="bottom-section" id="forecast-section">
      <Timeline hours={forecast} hour={hour} horizon={horizon} playing={playing} onHour={value => { setHour(value); setPlaying(false); }} onHorizon={changeHorizon} onPlay={() => setPlaying(v => !v)} />
      <div className="command-row"><label className="date-control"><span>Issue date</span><input type="date" aria-label="Forecast start date" value={date} min="2026-02-01" max="2026-02-28" onChange={e => { if (availableDates.includes(e.target.value)) { setDate(e.target.value); setHour(0); setPlaying(false); } }} /></label><AssistantBar hours={forecast.slice(0, horizon)} /><span className="demo-note">Archived forecast · {turbines.length} turbines</span></div>
    </div>
    <AnalyticsSection hours={forecast} horizon={horizon} selected={selected} activeHour={hour} date={date} />
  </main>;
}
