import { Suspense, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Group } from 'three';
import type { Reading, Turbine as TurbineData } from '../forecast/forecast';
import { spreadSurfacePlacement } from './placement';
import { sceneConfig } from './config';
import { TurbineAsset } from './ModelAsset';
import { Icon } from '../components/Icon';

export function ProceduralTurbine({ windSpeed, motion }: { windSpeed: number; motion: boolean }) {
  const rotor = useRef<Group>(null);
  useFrame((_, dt) => { if (rotor.current && motion) rotor.current.rotation.z -= Math.min(dt, 0.05) * windSpeed * sceneConfig.bladeSpeed; });
  return <group>
    <mesh castShadow position={[0, 0.38, 0]}><cylinderGeometry args={[0.025, 0.048, 0.76, 8]} /><meshStandardMaterial color="#fbfbf4" roughness={0.45} /></mesh>
    <mesh castShadow position={[0, 0.78, 0.015]}><boxGeometry args={[0.115, 0.085, 0.19]} /><meshStandardMaterial color="#fffef8" /></mesh>
    <group ref={rotor} position={[0, 0.78, 0.13]}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}><coneGeometry args={[0.052, 0.09, 10]} /><meshStandardMaterial color="#fffef8" /></mesh>
      {[0, 1, 2].map(i => <group key={i} rotation={[0, 0, i * Math.PI * 2 / 3]}><mesh castShadow position={[0.015, 0.17, 0]} rotation={[0, 0, -0.1]}><coneGeometry args={[0.04, 0.37, 3]} /><meshStandardMaterial color="#ffffff" roughness={0.48} /></mesh></group>)}
    </group>
  </group>;
}

interface Props { turbine: TurbineData; side: -1 | 1; reading: Reading; selected: boolean; offline?: boolean; onSelect: (id: string) => void; weather: boolean; motion: boolean; suppliedModel: boolean }
export function Turbine({ turbine, side, reading, selected, offline = false, onSelect, weather, motion, suppliedModel }: Props) {
  const [hovered, setHovered] = useState(false);
  const placement = spreadSurfacePlacement(turbine.lat, turbine.lon, side);
  const url = suppliedModel ? '/models/supplied-turbine.glb' : sceneConfig.turbineModel;
  const rotorSpeed = turbine.status === 'offline' || offline ? 0 : reading.windSpeed;
  function select(event: ThreeEvent<MouseEvent>) { event.stopPropagation(); if (event.delta <= 5) onSelect(turbine.id); }
  return <group {...placement}>
    <group scale={sceneConfig.turbineScale} onClick={select} onPointerOver={e => { e.stopPropagation(); setHovered(true); }} onPointerOut={() => setHovered(false)}>
      <mesh receiveShadow position={[0, 0.012, 0]}><cylinderGeometry args={[0.11, 0.14, 0.055, 12]} /><meshStandardMaterial color={offline ? '#dfa79a' : selected || hovered ? '#a7d6a2' : '#d1d6bd'} /></mesh>
      {url ? <Suspense fallback={<ProceduralTurbine windSpeed={rotorSpeed} motion={motion} />}><TurbineAsset url={url} windSpeed={rotorSpeed} motion={motion} /></Suspense> : <ProceduralTurbine windSpeed={rotorSpeed} motion={motion} />}
      {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.046, 0]}><ringGeometry args={[0.16, 0.18, 40]} /><meshBasicMaterial color="#c9f5ac" side={2} /></mesh>}
    </group>
    {weather && <Html position={[0, sceneConfig.weatherHeight, 0]} center occlude zIndexRange={[20, 0]}><button className={`weather-marker ${selected ? 'active' : ''}`} onClick={() => onSelect(turbine.id)} aria-label={`Select ${turbine.name}, ${offline ? 'simulated offline' : `wind ${reading.windSpeed.toFixed(1)} meters per second`}`}><Icon name="wind" size={14} /><span>{offline ? 'OFF' : reading.windSpeed.toFixed(1)}{!offline && <small>m/s</small>}</span></button></Html>}
  </group>;
}
