import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AmbientLight, Color, DirectionalLight, HemisphereLight, MathUtils, Vector3 } from 'three';
import type { ForecastEnvironment } from '../forecast/environment';
import { seasonPalette, timePalette } from './environmentPresets';
import { sceneConfig } from './config';

export function DynamicLighting({ environment, motion }: { environment: ForecastEnvironment; motion: boolean }) {
  const ambient = useRef<AmbientLight>(null);
  const fill = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const target = useMemo(() => {
    const time = timePalette[environment.timeOfDay];
    const season = seasonPalette[environment.season];
    const angle = (environment.hour - 6) / 12 * Math.PI;
    return {
      ...time, fillColor: new Color(time.fill),
      sunColor: new Color(time.sun).lerp(new Color(season.sun), environment.timeOfDay === 'day' ? 0.45 : 0.15),
      position: environment.timeOfDay === 'night' ? new Vector3(-4, 5, 3) : new Vector3(Math.cos(angle) * 7, Math.max(0.8, Math.sin(angle) * 8), 4),
    };
  }, [environment]);
  useFrame((_, delta) => {
    if (!ambient.current || !fill.current || !sun.current) return;
    const alpha = motion ? 1 - Math.exp(-sceneConfig.environmentDamping * Math.min(delta, 0.1)) : 1;
    ambient.current.intensity = MathUtils.lerp(ambient.current.intensity, target.ambient, alpha);
    ambient.current.color.lerp(target.fillColor, alpha);
    fill.current.color.lerp(target.fillColor, alpha);
    fill.current.intensity = MathUtils.lerp(fill.current.intensity, target.ambient * 0.85, alpha);
    sun.current.color.lerp(target.sunColor, alpha);
    sun.current.intensity = MathUtils.lerp(sun.current.intensity, target.key, alpha);
    sun.current.position.lerp(target.position, alpha);
  });
  return <>
    <ambientLight ref={ambient} intensity={1} />
    <hemisphereLight ref={fill} args={['#dce6ed', '#515e62', 1]} />
    <directionalLight ref={sun} position={[-3, 7, 5]} intensity={2} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} shadow-normalBias={0.035} shadow-radius={3} />
    <directionalLight position={[4, 1, -3]} intensity={0.75} color="#adc7e5" />
  </>;
}
