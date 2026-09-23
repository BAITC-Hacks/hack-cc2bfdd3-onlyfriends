import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Fog } from 'three';
import type { ForecastEnvironment } from '../forecast/environment';
import { seasonPalette, timePalette } from './environmentPresets';
import { sceneConfig } from './config';

export function SkyController({ environment, motion }: { environment: ForecastEnvironment; motion: boolean }) {
  const { scene } = useThree();
  const target = useMemo(() => new Color(timePalette[environment.timeOfDay].sky).lerp(
    new Color(seasonPalette[environment.season].sky), environment.timeOfDay === 'day' ? 0.7 : environment.timeOfDay === 'sunrise' ? 0.25 : 0.04,
  ), [environment]);
  const background = useMemo(() => new Color('#eeeae3'), []);
  const fog = useMemo(() => new Fog('#eeeae3', 28, 65), []);
  useEffect(() => {
    const previousBackground = scene.background, previousFog = scene.fog;
    scene.background = background; scene.fog = fog;
    return () => { scene.background = previousBackground; scene.fog = previousFog; };
  }, [scene, background, fog]);
  useFrame((_, delta) => {
    const alpha = motion ? 1 - Math.exp(-sceneConfig.environmentDamping * Math.min(delta, 0.1)) : 1;
    background.lerp(target, alpha);
    fog.color.copy(background);
  });
  return null;
}
