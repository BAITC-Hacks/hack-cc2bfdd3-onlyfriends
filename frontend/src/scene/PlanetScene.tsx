import { Component, Suspense, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { turbines, type ForecastHour } from '../forecast/forecast';
import type { DisplaySettings } from '../components/Settings';
import { Planet, Clouds } from './Planet';
import { Turbine } from './Turbine';
import { PlanetInteraction } from './PlanetInteraction';
import { sceneConfig } from './config';
import type { ForecastEnvironment } from '../forecast/environment';
import { SeasonalEnvironment } from './SeasonalEnvironment';
import { DynamicLighting } from './DynamicLighting';
import { SkyController } from './SkyController';
import { Landscape } from './Landscape';
import type { WindAt } from './useWindAt';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-fallback"><strong>Your planet couldn’t load.</strong><p>Check WebGL support or the selected model file. Forecast controls remain available.</p></div> : this.props.children; }
}
interface Props { hour: ForecastHour; selected: string[]; onSelect: (id: string) => void; environment: ForecastEnvironment; reset: number; zoom: number; onZoom: (zoom: number) => void; settings: DisplaySettings; wind: WindAt }
export default function PlanetScene({ hour, selected, onSelect, environment, reset, zoom, onZoom, settings, wind }: Props) {
  return <SceneBoundary key={String(settings.suppliedModel)}><Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 1.3, sceneConfig.cameraDistance], fov: 38 }} gl={{ antialias: true, alpha: true }} fallback={<div className="scene-fallback">WebGL is unavailable. Explore your forecast with the controls below.</div>}>
    <DynamicLighting environment={environment} motion={settings.motion} />
    <SkyController environment={environment} motion={settings.motion} />
    <Suspense fallback={null}><SeasonalEnvironment season={environment.season} motion={settings.motion}><PlanetInteraction motion={settings.motion} reset={reset} zoom={zoom} onZoom={onZoom} landscape={<Landscape hour={hour} selected={selected} onSelect={onSelect} motion={settings.motion} showLabels={zoom > 3.6} wind={wind} />}>
      <Planet />
      {turbines.map(turbine => <Turbine key={turbine.id} turbine={turbine} reading={hour.readings.find(r => r.turbineId === turbine.id)!} selected={selected.includes(turbine.id)} onSelect={onSelect} {...settings} />)}
      <Clouds />
    </PlanetInteraction></SeasonalEnvironment></Suspense>
    {zoom < 3.2 && <ContactShadows position={[0, -2.4, 0]} opacity={0.23} scale={9} blur={2.8} far={6} resolution={256} color="#526347" />}
  </Canvas></SceneBoundary>;
}
