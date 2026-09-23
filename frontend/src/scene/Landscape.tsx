import { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { CatmullRomCurve3, Color, ConeGeometry, DodecahedronGeometry, Float32BufferAttribute, MeshStandardMaterial, PlaneGeometry, TubeGeometry, Vector3 } from 'three';
import terrain from '../data/shelek-terrain.json';
import { turbines, type ForecastHour } from '../forecast/forecast';
import { ProceduralTurbine } from './Turbine';
import { WindField } from './WindField';
import type { WindAt } from './useWindAt';

const [centerLat, centerLon] = terrain.center;
const [spanLat, spanLon] = terrain.span;
const LOCAL_SIZE = 3.6;
const REGIONAL_SIZE = 36;
const BASE_ELEVATION = 560;

export function localPosition(lat: number, lon: number): [number, number, number] {
  const x = (lon - centerLon) / spanLon * LOCAL_SIZE;
  const z = -(lat - centerLat) / spanLat * LOCAL_SIZE;
  const row = Math.max(0, Math.min(64, Math.round((0.5 - (lat - centerLat) / spanLat) * 64)));
  const column = Math.max(0, Math.min(64, Math.round(((lon - centerLon) / spanLon + 0.5) * 64)));
  return [x, (terrain.heights[row][column] - BASE_ELEVATION) / 220 + 0.015, z];
}

function TerrainMesh({ heights, size, regional }: { heights: number[][]; size: number; regional: boolean }) {
  const geometry = useMemo(() => {
    const mesh = new PlaneGeometry(size, size, 64, 64);
    mesh.rotateX(-Math.PI / 2);
    const positions = mesh.getAttribute('position');
    const colors: number[] = [];
    for (let row = 0; row < 65; row++) for (let column = 0; column < 65; column++) {
      const index = row * 65 + column;
      const height = heights[row][column];
      positions.setY(index, (height - BASE_ELEVATION) / 220 + (regional ? -0.09 : 0.01));
      const field = Math.sin(column * 0.19 + Math.sin(row * 0.1)) + Math.cos(row * 0.16 - column * 0.035);
      const color = regional
        ? new Color(height > 1350 ? '#dce2db' : height > 1000 ? '#a9a89a' : height > 700 ? '#bfa982' : '#91aa83')
        : new Color(field > 1.1 ? '#d8bd8c' : field > 0.3 ? '#bfae7d' : field < -0.55 ? '#80a773' : '#acc68f');
      colors.push(color.r, color.g, color.b);
    }
    mesh.setAttribute('color', new Float32BufferAttribute(colors, 3));
    mesh.computeVertexNormals();
    return mesh;
  }, [heights, size, regional]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} receiveShadow castShadow><meshStandardMaterial vertexColors roughness={1} flatShading side={2} /></mesh>;
}

function Waterways() {
  const paths = useMemo(() => terrain.waterways.map(line => {
    const points = line.map(([east, north]) => {
      const row = Math.max(0, Math.min(64, Math.round((0.5 - north) * 64)));
      const column = Math.max(0, Math.min(64, Math.round((east + 0.5) * 64)));
      return new Vector3(east * REGIONAL_SIZE, (terrain.regionalHeights[row][column] - BASE_ELEVATION) / 220 - 0.055, -north * REGIONAL_SIZE);
    });
    const curve = new CatmullRomCurve3(points);
    const bank = new TubeGeometry(curve, Math.max(4, points.length * 4), 0.19, 6, false);
    const water = new TubeGeometry(new CatmullRomCurve3(points.map(point => point.clone().add(new Vector3(0, 0.09, 0)))), Math.max(4, points.length * 4), 0.135, 6, false);
    return { bank, water };
  }), []);
  useEffect(() => () => paths.forEach(path => { path.bank.dispose(); path.water.dispose(); }), [paths]);
  return <group>{paths.map(({ bank, water }, index) => <group key={index}>
    <mesh geometry={bank}><meshStandardMaterial color="#d8bb89" roughness={1} /></mesh>
    <mesh geometry={water}><meshStandardMaterial color="#62bfdb" emissive="#187b9a" emissiveIntensity={0.35} roughness={0.3} /></mesh>
  </group>)}</group>;
}

function Tracks() {
  const paths = useMemo(() => terrain.roads.map(line => {
    const points = line.map(([east, north]) => {
      const row = Math.max(0, Math.min(64, Math.round((0.5 - north) * 64)));
      const column = Math.max(0, Math.min(64, Math.round((east + 0.5) * 64)));
      return new Vector3(east * LOCAL_SIZE, (terrain.heights[row][column] - BASE_ELEVATION) / 220 + 0.036, -north * LOCAL_SIZE);
    });
    return new TubeGeometry(new CatmullRomCurve3(points), Math.max(4, points.length * 5), 0.016, 4, false);
  }), []);
  useEffect(() => () => paths.forEach(path => path.dispose()), [paths]);
  return <group>{paths.map((geometry, index) => <mesh key={index} geometry={geometry}><meshStandardMaterial color="#d4b685" roughness={1} /></mesh>)}</group>;
}

function GroundDetails() {
  const details = useMemo(() => Array.from({ length: 75 }, (_, index) => {
    const x = ((index * 47) % 79) / 79 * 3.3 - 1.65;
    const z = ((index * 31) % 83) / 83 * 3.3 - 1.65;
    const lat = centerLat - z / LOCAL_SIZE * spanLat;
    const lon = centerLon + x / LOCAL_SIZE * spanLon;
    return { x, z, y: localPosition(lat, lon)[1], size: 0.65 + index % 5 * 0.15, rock: index % 8 === 0 };
  }), []);
  const grass = useMemo(() => new ConeGeometry(0.035, 0.12, 4), []);
  const rock = useMemo(() => new DodecahedronGeometry(0.075, 0), []);
  const grassMaterial = useMemo(() => new MeshStandardMaterial({ color: '#729671', roughness: 1 }), []);
  const rockMaterial = useMemo(() => new MeshStandardMaterial({ color: '#d1c1a0', roughness: 1 }), []);
  useEffect(() => () => { grass.dispose(); rock.dispose(); grassMaterial.dispose(); rockMaterial.dispose(); }, [grass, rock, grassMaterial, rockMaterial]);
  return <group>{details.map((detail, index) => <mesh key={index} geometry={detail.rock ? rock : grass} material={detail.rock ? rockMaterial : grassMaterial} position={[detail.x, detail.y + (detail.rock ? 0.03 : 0.06), detail.z]} scale={detail.size} castShadow />)}</group>;
}

export function Landscape({ hour, selected, onSelect, motion, showLabels, wind, offlineTurbineId }: { hour: ForecastHour; selected: string[]; onSelect: (id: string) => void; motion: boolean; showLabels: boolean; wind: WindAt; offlineTurbineId: string | null }) {
  return <group>
    <TerrainMesh heights={terrain.regionalHeights} size={REGIONAL_SIZE} regional />
    <Waterways />
    <TerrainMesh heights={terrain.heights} size={LOCAL_SIZE} regional={false} />
    <Tracks />
    <GroundDetails />
    <WindField speed={wind.speed} direction={wind.direction} motion={motion} />
    {turbines.map(turbine => {
      const reading = hour.readings.find(item => item.turbineId === turbine.id)!;
      return <group key={turbine.id} position={localPosition(turbine.lat, turbine.lon)}>
        <mesh receiveShadow position={[0, 0.015, 0]} onClick={e => { e.stopPropagation(); onSelect(turbine.id); }}><cylinderGeometry args={[0.13, 0.16, 0.03, 16]} /><meshStandardMaterial color={offlineTurbineId === turbine.id ? '#dfa79a' : selected.includes(turbine.id) ? '#e9f8d4' : '#cad8b9'} /></mesh>
        <group scale={0.34} onClick={e => { e.stopPropagation(); onSelect(turbine.id); }}><ProceduralTurbine windSpeed={offlineTurbineId === turbine.id ? 0 : reading.windSpeed100} motion={motion} /></group>
        {showLabels && <Html position={[0, 0.42, 0]} center distanceFactor={6}><button className="landscape-label" onClick={() => onSelect(turbine.id)}>{turbine.name}<span>{offlineTurbineId === turbine.id ? 'OFF · what-if' : `${reading.windSpeed100.toFixed(1)} m/s · ${reading.power.toFixed(3)}`}</span></button></Html>}
      </group>;
    })}
  </group>;
}
