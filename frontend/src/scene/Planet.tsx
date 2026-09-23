import { useEffect, useMemo } from 'react';
import { Color, Float32BufferAttribute, IcosahedronGeometry } from 'three';
import { PLANET_RADIUS, surfacePlacement } from './placement';
import { sceneConfig } from './config';
import { EarthAsset } from './ModelAsset';

function Terrain() {
  const geometry = useMemo(() => {
    const geo = new IcosahedronGeometry(PLANET_RADIUS, 3);
    const positions = geo.getAttribute('position');
    const colors: number[] = [];
    const palette = ['#74a66b', '#82b471', '#8ebb78', '#97bd7a', '#a3c886', '#699b66'];
    for (let i = 0; i < positions.count; i += 3) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const seed = Math.abs(Math.sin(x * 19.1 + y * 43.7 + z * 13.4));
      const color = new Color(palette[Math.floor(seed * palette.length) % palette.length]);
      for (let v = 0; v < 3; v++) colors.push(color.r, color.g, color.b);
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial vertexColors flatShading roughness={0.95} /></mesh>;
}

function Tree({ lat, lon, size, variant }: { lat: number; lon: number; size: number; variant: number }) {
  return <group {...surfacePlacement(lat, lon, 0)} scale={size}>
    <mesh castShadow position={[0, 0.085, 0]}><cylinderGeometry args={[0.024, 0.03, 0.18, 5]} /><meshStandardMaterial color="#76604a" /></mesh>
    {variant ? <><mesh castShadow position={[0, 0.2, 0]}><coneGeometry args={[0.14, 0.28, 6]} /><meshStandardMaterial color="#326947" flatShading /></mesh><mesh castShadow position={[0, 0.32, 0]}><coneGeometry args={[0.11, 0.26, 6]} /><meshStandardMaterial color="#468254" flatShading /></mesh></> : <mesh castShadow position={[0, 0.23, 0]} scale={[1, 1.25, 1]}><icosahedronGeometry args={[0.155, 0]} /><meshStandardMaterial color="#3d7b4a" flatShading /></mesh>}
  </group>;
}

export function Planet() {
  const trees = useMemo(() => Array.from({ length: 58 }, (_, i) => ({ lat: Math.asin(1 - 2 * (i + 0.5) / 58) * 180 / Math.PI, lon: i * 137.508 % 360, size: 0.7 + (Math.sin(i * 12.9) + 1) * 0.28, variant: i % 3 })), []);
  return <group>
    {sceneConfig.earthModel ? <EarthAsset url={sceneConfig.earthModel} /> : <Terrain />}
    {trees.map((tree, i) => <Tree key={i} {...tree} />)}
    {[[-38, 70], [-10, -100], [15, 100], [6, -15]].map(([lat, lon], i) => <group key={i} {...surfacePlacement(lat, lon, -0.04)}><mesh castShadow scale={[0.2, 0.1, 0.13]}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#a3ad91" flatShading /></mesh></group>)}
  </group>;
}

export function Clouds() {
  return <group>{[
    [-1.8, 1.15, -0.8, 0.85], [1.75, 0.7, 0.3, 0.72], [-1.8, -0.65, 0.7, 0.65], [0.5, 1.3, -1.6, 0.75], [0.8, -1.25, 1.4, 0.5],
  ].map(([x, y, z, scale], i) => <group key={i} position={[x, y, z]} scale={scale}>{[-1, 0, 1].map((p, j) => <mesh key={j} position={[p * 0.21, j === 1 ? 0.08 : 0, 0]} scale={[1.25, 0.72, 0.8]}><icosahedronGeometry args={[j === 1 ? 0.29 : 0.22, 2]} /><meshStandardMaterial color="#ffffff" roughness={1} flatShading /></mesh>)}</group>)}</group>;
}
