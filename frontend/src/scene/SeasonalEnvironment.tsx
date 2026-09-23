import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshStandardMaterial } from 'three';
import type { Season } from '../forecast/environment';
import { seasonPalette } from './environmentPresets';
import { sceneConfig } from './config';

function createMaterials() {
  return {
    terrain: new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
    foliage: Array.from({ length: 3 }, () => new MeshStandardMaterial({ flatShading: true, roughness: 1 })),
    snow: new MeshStandardMaterial({ color: '#eff5f5', roughness: 1, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
}
const MaterialsContext = createContext<ReturnType<typeof createMaterials> | null>(null);
export function useSeasonalMaterials() {
  const value = useContext(MaterialsContext);
  if (!value) throw new Error('Seasonal materials must be inside SeasonalEnvironment.');
  return value;
}

/** Shared materials survive date changes: no geometry or GLTF reloads. */
export function SeasonalEnvironment({ season, motion, children }: { season: Season; motion: boolean; children: ReactNode }) {
  const materials = useMemo(createMaterials, []);
  const target = useMemo(() => {
    const palette = seasonPalette[season];
    return { terrain: new Color(palette.terrain), foliage: palette.foliage.map(c => new Color(c)), snow: palette.snow };
  }, [season]);
  useEffect(() => () => { materials.terrain.dispose(); materials.snow.dispose(); materials.foliage.forEach(m => m.dispose()); }, [materials]);
  useFrame((_, delta) => {
    const alpha = motion ? 1 - Math.exp(-sceneConfig.environmentDamping * Math.min(delta, 0.1)) : 1;
    materials.terrain.color.lerp(target.terrain, alpha);
    materials.foliage.forEach((material, i) => material.color.lerp(target.foliage[i], alpha));
    materials.snow.opacity += (target.snow - materials.snow.opacity) * alpha;
    materials.snow.visible = materials.snow.opacity > 0.005;
  });
  return <MaterialsContext.Provider value={materials}>{children}</MaterialsContext.Provider>;
}
