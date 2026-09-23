import { lazy, Suspense, useEffect, useState } from 'react';
import { Icon } from './components/Icon';
import { MetricsPanel } from './components/MetricsPanel';
import { Timeline } from './components/Timeline';
import { AssistantBar } from './components/AssistantBar';
import { Settings, type DisplaySettings } from './components/Settings';
import { forecast, hourLabel } from './forecast/forecast';

const PlanetScene = lazy(() => import('./scene/PlanetScene'));
export default function App() {
  const [hour, setHour] = useState(0);
  const [horizon, setHorizon] = useState<24 | 48>(48);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<1 | 2>(1);
  const [reset, setReset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settings, setSettings] = useState<DisplaySettings>({ weather: true, motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, suppliedModel: false });
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
  return <main className="app-shell">
    <header className="site-header"><a className="brand" href="./" aria-label="OnlyFriends home"><span className="brand-symbol"><i /><i /><i /></span>onlyfriends<span className="brand-dot">®</span></a><nav aria-label="Main navigation"><button className="nav-active" onClick={() => { setInfoOpen(false); setSelected(null); }}>Overview</button><button onClick={() => document.getElementById('forecast-section')?.scrollIntoView({ behavior: settings.motion ? 'smooth' : 'instant' })}>Forecast</button><button onClick={() => setInfoOpen(value => !value)} aria-expanded={infoOpen}>Our mission<Icon name="diagonal" size={13} /></button></nav><div className="header-right"><span className="demo-indicator"><i /> DEMO ENVIRONMENT</span><button className="avatar" aria-label="Open display settings" onClick={() => setSettingsOpen(value => !value)}>OF</button></div></header>
    {infoOpen && <section className="mission-card"><button className="icon-button small" aria-label="Close mission" onClick={() => setInfoOpen(false)}><Icon name="close" /></button><span className="eyebrow">Energy, in good company.</span><h2>A clearer view of a cleaner future.</h2><p>OnlyFriends explores how weather becomes wind energy. This interactive concept uses six illustrative turbines and 48 hours of mock forecasts. It is the frontend companion to the wind forecasting project.</p></section>}
    <section className="world-section" aria-label="Interactive wind farm overview">
      <div className="hero-copy"><div className="location-tag"><span className="location-dot" /> SHELEK, KAZAKHSTAN<Icon name="diagonal" size={12} /></div><h1>Small planet.<br /><span>Big potential.</span></h1><p>A fresh perspective on wind energy.<br />See what tomorrow has in store.</p><div className="hero-meta"><span className="leaf-badge"><Icon name="leaf" size={17} /></span><span>Powered by nature.<br /><strong>Made for a better tomorrow.</strong></span></div></div>
      <div className="planet-stage"><div className="planet-halo" /><Suspense fallback={<div className="scene-loading"><span />Growing your little world…</div>}><PlanetScene hour={forecast[hour]} selected={selected} onSelect={setSelected} zoom={zoom} reset={reset} settings={settings} /></Suspense></div>
      <div className="orbit-caption"><span className="mini-line" /> YOUR ENERGY ECOSYSTEM</div>
      <MetricsPanel hour={forecast[hour]} selected={selected} onSelect={setSelected} />
      <div className="scene-tools"><div className="zoom-toggle" aria-label="Planet zoom">{([1, 2] as const).map(value => <button key={value} aria-pressed={zoom === value} onClick={() => setZoom(value)}>{value}×</button>)}</div><button className="icon-button" onClick={() => { setReset(v => v + 1); setZoom(1); }} aria-label="Reset planet view"><Icon name="reset" size={16} /></button><button className="icon-button" onClick={() => setSettingsOpen(v => !v)} aria-label="Display settings" aria-expanded={settingsOpen}><Icon name="settings" size={16} /></button></div>
      <div className="drag-hint"><Icon name="globe" size={14} /><span>Drag to explore</span><i />Select a turbine</div>
      {settingsOpen && <Settings value={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />}
      <div className="scene-stamp"><span className="status-dot" /> 6 TURBINES CONNECTED<span>21.6 MW installed capacity · Demo</span></div>
    </section>
    <div className="bottom-section" id="forecast-section"><div className="forecast-date"><span><Icon name="weather" size={17} />{hourLabel(forecast[hour].at, true)}<small>UTC+5</small></span><span>48 hours of possibility <Icon name="arrow" size={15} /></span></div><Timeline hour={hour} horizon={horizon} playing={playing} onHour={value => { setHour(value); setPlaying(false); }} onHorizon={changeHorizon} onPlay={() => setPlaying(v => !v)} /><AssistantBar hours={forecast.slice(0, horizon)} /></div>
    <footer><span>BETTER TOGETHER. BETTER FOR THE PLANET.</span><span>Illustrative data <i /> Thoughtfully built for tomorrow<Icon name="leaf" size={13} /></span></footer>
  </main>;
}
