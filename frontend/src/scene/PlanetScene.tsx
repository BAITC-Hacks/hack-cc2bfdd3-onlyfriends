import { Component, Suspense, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import { turbines, type ForecastHour } from '../forecast/forecast';
import type { DisplaySettings } from '../components/Settings';
import { Planet, Clouds } from './Planet';
import { Turbine } from './Turbine';
import { CameraRig, PlanetInteraction } from './PlanetInteraction';
import { sceneConfig } from './config';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-fallback"><strong>Your planet couldn’t load.</strong><p>Check WebGL support or the selected model file. Forecast controls remain available.</p></div> : this.props.children; }
}
interface Props { hour: ForecastHour; selected: string | null; onSelect: (id: string) => void; zoom: 1 | 2; reset: number; settings: DisplaySettings }
export default function PlanetScene({ hour, selected, onSelect, zoom, reset, settings }: Props) {
  return <SceneBoundary key={String(settings.suppliedModel)}><Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 1.3, sceneConfig.cameraDistance], fov: 38 }} gl={{ antialias: true, alpha: true }} fallback={<div className="scene-fallback">WebGL is unavailable. Explore your forecast with the controls below.</div>}>
    <ambientLight intensity={1.5} />
    <hemisphereLight args={['#fbfff7', '#778775', 1.3]} />
    <directionalLight position={[-3, 7, 5]} intensity={3.1} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={5} shadow-camera-bottom={-4} shadow-normalBias={0.035} />
    <directionalLight position={[4, 1, -3]} intensity={1.5} color="#e7f3ff" />
    <Suspense fallback={null}><PlanetInteraction motion={settings.motion} reset={reset}>
      <Planet />
      {turbines.map(turbine => <Turbine key={turbine.id} turbine={turbine} reading={hour.readings.find(r => r.turbineId === turbine.id)!} selected={selected === turbine.id} onSelect={onSelect} {...settings} />)}
      <Clouds />
    </PlanetInteraction></Suspense>
    <ContactShadows position={[0, -2.4, 0]} opacity={0.23} scale={9} blur={2.8} far={6} resolution={256} color="#526347" />
    <CameraRig zoom={zoom} motion={settings.motion} />
  </Canvas></SceneBoundary>;
}
