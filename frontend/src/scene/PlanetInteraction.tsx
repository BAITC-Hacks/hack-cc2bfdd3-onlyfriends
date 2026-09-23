import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, MathUtils } from 'three';
import { sceneConfig } from './config';
import { bindPlanetGestures, createInteraction, cameraFraming } from './interaction';

export function PlanetInteraction({ children, motion, reset, zoom, onZoom, focus }: { children: ReactNode; motion: boolean; reset: number; zoom: number; onZoom: (zoom: number) => void; focus: { lat: number; lon: number } }) {
  const root = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const { gl, size } = useThree();
  const state = useRef(createInteraction());
  useEffect(() => { Object.assign(state.current, createInteraction(), { pitch: MathUtils.clamp(focus.lat * Math.PI / 180, -0.75, 0.75), yaw: -focus.lon * Math.PI / 180 }); }, [reset, focus.lat, focus.lon]);
  useEffect(() => { state.current.zoom = zoom; }, [zoom]);
  useEffect(() => bindPlanetGestures(gl.domElement, state.current, onZoom), [gl, onZoom]);
  useFrame(({ clock, camera }, delta) => {
    if (!root.current || !spin.current) return;
    const dt = Math.min(delta, 0.05), s = state.current;
    if (!s.down && motion) { s.yaw += s.vx * dt * 35 + dt * sceneConfig.idleRotation; s.pitch = MathUtils.clamp(s.pitch + s.vy * dt * 35, -0.75, 0.75); }
    s.vx *= Math.exp(-sceneConfig.inertiaDamping * dt); s.vy *= Math.exp(-sceneConfig.inertiaDamping * dt);
    spin.current.rotation.y = MathUtils.damp(spin.current.rotation.y, s.yaw, motion ? 10 : 100, dt);
    spin.current.rotation.x = MathUtils.damp(spin.current.rotation.x, s.pitch, motion ? 10 : 100, dt);
    root.current.position.y = motion ? Math.sin(clock.elapsedTime * sceneConfig.floatSpeed) * sceneConfig.floatAmplitude : 0;
    root.current.rotation.z = motion ? Math.sin(clock.elapsedTime * 0.55) * 0.017 : 0;
    const { distance, lensZoom } = cameraFraming(size.width / Math.max(1, size.height), s.zoom);
    camera.position.z = motion ? MathUtils.damp(camera.position.z, distance, sceneConfig.cameraDamping, dt) : distance;
    camera.zoom = motion ? MathUtils.damp(camera.zoom, lensZoom, sceneConfig.cameraDamping, dt) : lensZoom;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0.18, 0);
  });
  return <group ref={root}><group ref={spin}>{children}</group></group>;
}
