import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Icon } from './components/Icon';
import { MetricsPanel } from './components/MetricsPanel';
import { Timeline } from './components/Timeline';
import { AssistantBar } from './components/AssistantBar';
import { Settings, type DisplaySettings } from './components/Settings';
import { createForecast, DEFAULT_DATE, turbines } from './forecast/forecast';
import { environmentAt } from './forecast/environment';
import { TurbinesPage } from './turbines/TurbinesPage';
import { toggleSelection } from './turbines/tableModel';

const PlanetScene = lazy(() => import('./scene/PlanetScene'));
export default function App() {
  const [date, setDate] = useState(DEFAULT_DATE);
  const [hour, setHour] = useState(0);
  const [horizon, setHorizon] = useState<24 | 48>(48);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<'overview' | 'turbines'>(() => window.location.hash === '#turbines' ? 'turbines' : 'overview');
  const [zoom, setZoom] = useState(1);
  const [reset, setReset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settings, setSettings] = useState<DisplaySettings>({ weather: true, motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, suppliedModel: false });
  const forecast = useMemo(() => createForecast(date), [date]);
  const environment = useMemo(() => environmentAt(forecast[hour].at), [forecast, hour]);
  useEffect(() => {
    const syncView = () => setView(window.location.hash === '#turbines' ? 'turbines' : 'overview');
    window.addEventListener('hashchange', syncView);
    window.addEventListener('popstate', syncView);
    return () => { window.removeEventListener('hashchange', syncView); window.removeEventListener('popstate', syncView); };
  }, []);
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
      <nav className="view-tabs" aria-label="Main navigation">{(['overview', 'turbines'] as const).map(next => <a key={next} href={`#${next}`} aria-current={view === next ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(next); }}>{next === 'overview' ? 'Overview' : 'Turbines'}</a>)}</nav>
      <button className="demo-indicator" aria-label="About this demo" aria-expanded={infoOpen} onClick={() => setInfoOpen(v => !v)}><i /> DEMO</button>
    </header>
    {infoOpen && <section className="mission-card"><button className="icon-button small" aria-label="Close mission" onClick={() => setInfoOpen(false)}><Icon name="close" size={15} /></button><h2>A clearer energy future.</h2><p>Six illustrative turbines. One shared forecast. Explore how seasons, weather and time shape this little world. All predictions and assistant responses use local demo data.</p></section>}
    {view === 'turbines' ? <TurbinesPage hour={forecast[hour]} selected={selected} onSelection={setSelected} onView3D={() => navigate('overview')} /> : <section className="world-section" aria-label="Interactive wind farm overview">
      <div className="planet-stage"><Suspense fallback={<div className="scene-loading">Growing your little world…</div>}><PlanetScene hour={forecast[hour]} selected={selected} onSelect={id => setSelected(current => toggleSelection(current, id))} environment={environment} reset={reset} zoom={zoom} onZoom={setZoom} settings={settings} /></Suspense></div>
      <div className="hero-copy"><span className="eyebrow">Energy, in perspective</span><h1>Small planet.<br /><span>Big potential.</span></h1><div className="environment-label" aria-label="Scene environment"><Icon name={environment.timeOfDay === 'night' ? 'moon' : 'sun'} size={12} /><span>{environment.season} · {environment.timeOfDay}</span></div></div>
      <MetricsPanel hour={forecast[hour]} selected={selected} onSelect={setSelected} />
      <div className="scene-tools"><div className="zoom-presets" role="group" aria-label="Planet zoom presets">{[1, 2, 3, 4, 5].map(value => <button key={value} aria-pressed={Math.abs(zoom - value) < 0.015} onClick={() => setZoom(value)}>{value}×</button>)}</div><button className="icon-button" onClick={() => { setReset(v => v + 1); setZoom(1); }} aria-label="Reset planet view"><Icon name="reset" size={15} /></button><button className="icon-button" onClick={() => setSettingsOpen(v => !v)} aria-label="Display settings" aria-expanded={settingsOpen}><Icon name="settings" size={15} /></button></div>
      <div className="drag-hint">Drag to rotate <i /> Scroll or pinch to zoom</div>
      {settingsOpen && <Settings value={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
    </section>}
    <div className="bottom-section" id="forecast-section">
      <Timeline hours={forecast} hour={hour} horizon={horizon} playing={playing} onHour={value => { setHour(value); setPlaying(false); }} onHorizon={changeHorizon} onPlay={() => setPlaying(v => !v)} />
      <div className="command-row"><label className="date-control"><span>Forecast date</span><input type="date" aria-label="Forecast start date" value={date} min="2020-01-01" max="2100-12-31" onChange={e => { if (e.target.value && e.target.validity.valid) { setDate(e.target.value); setPlaying(false); } }} /></label><AssistantBar hours={forecast.slice(0, horizon)} /><span className="demo-note">Illustrative forecast · {turbines.length} turbines</span></div>
    </div>
  </main>;
}
