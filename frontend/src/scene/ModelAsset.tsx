import { useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { PLANET_RADIUS } from './placement';

/** GLTF contract: Y-up, turbine base normalized to zero. Optional Rotor node rotates on local Z. */
export function TurbineAsset({ url, rotorSpeed, motion }: { url: string; rotorSpeed: number; motion: boolean }) {
  const { scene } = useGLTF(url);
  const rotor = useRef<Object3D | undefined>(undefined);
  const visualSpeed = useRef(0);
  const { model, scale, offset } = useMemo(() => {
    const model = scene.clone(true);
    model.traverse(node => { if (node instanceof Mesh) { node.castShadow = true; node.receiveShadow = true; if (!node.geometry.attributes.normal) node.geometry.computeVertexNormals(); } });
    const bounds = new Box3().setFromObject(model);
    const center = bounds.getCenter(new Vector3());
    return { model, scale: 1.12 / Math.max(bounds.max.y - bounds.min.y, 0.001), offset: new Vector3(-center.x, -bounds.min.y, -center.z) };
  }, [scene]);
  useFrame((_, dt) => {
    visualSpeed.current += (rotorSpeed - visualSpeed.current) * Math.min(1, dt * 3);
    rotor.current ??= model.getObjectByName('Rotor');
    if (motion && rotor.current) rotor.current.rotation.z -= Math.min(dt, 0.05) * visualSpeed.current;
  });
  return <group scale={scale}><primitive object={model} position={offset} /></group>;
}

/** Earth asset contract: spherical terrain. Normalize its bounds to the procedural radius. */
export function EarthAsset({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const { model, scale, center } = useMemo(() => {
    const model = scene.clone(true);
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    return { model, scale: PLANET_RADIUS * 2 / Math.max(size.x, size.y, size.z), center: bounds.getCenter(new Vector3()).negate() };
  }, [scene]);
  return <group scale={scale}><primitive object={model} position={center} /></group>;
}
