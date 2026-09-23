import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AmbientLight, Group, MathUtils } from 'three';
import { sceneConfig } from './config';
import { bindPlanetGestures, createInteraction, cameraFraming } from './interaction';

export function PlanetInteraction({ children, landscape, motion, reset, zoom, onZoom }: { children: ReactNode; landscape: ReactNode; motion: boolean; reset: number; zoom: number; onZoom: (zoom: number) => void }) {
  const root = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const local = useRef<Group>(null);
  const localFill = useRef<AmbientLight>(null);
  const { gl, size } = useThree();
  const state = useRef(createInteraction());
  const renderedZoom = useRef(1);
  const renderedTarget = useRef({ x: 0, z: 0 });
  useEffect(() => { Object.assign(state.current, createInteraction()); }, [reset]);
  useEffect(() => { state.current.zoom = zoom; }, [zoom]);
  useEffect(() => bindPlanetGestures(gl.domElement, state.current, onZoom), [gl, onZoom]);
  useFrame(({ clock, camera }, delta) => {
    if (!root.current || !spin.current || !local.current) return;
    const dt = Math.min(delta, 0.05), s = state.current;
    if (!s.down && motion && s.zoom < 3.2) { s.yaw += s.vx * dt * 35 + dt * sceneConfig.idleRotation; s.pitch = MathUtils.clamp(s.pitch + s.vy * dt * 35, -0.75, 0.75); }
    s.vx *= Math.exp(-sceneConfig.inertiaDamping * dt); s.vy *= Math.exp(-sceneConfig.inertiaDamping * dt);
    spin.current.rotation.y = MathUtils.damp(spin.current.rotation.y, s.yaw, motion ? 10 : 100, dt);
    spin.current.rotation.x = MathUtils.damp(spin.current.rotation.x, s.pitch, motion ? 10 : 100, dt);
    renderedZoom.current = motion ? MathUtils.damp(renderedZoom.current, s.zoom, 4.5, dt) : s.zoom;
    const { distance, lensZoom } = cameraFraming(size.width / Math.max(1, size.height), renderedZoom.current);
    const transition = MathUtils.smoothstep(renderedZoom.current, 3, 5);
    root.current.position.y = motion ? Math.sin(clock.elapsedTime * sceneConfig.floatSpeed) * sceneConfig.floatAmplitude * (1 - transition) : 0;
    root.current.rotation.z = motion ? Math.sin(clock.elapsedTime * 0.55) * 0.017 * (1 - transition) : 0;
    spin.current.scale.setScalar(Math.max(0.001, 1 - transition * 0.999));
    spin.current.visible = transition < 0.995;
    local.current.scale.setScalar(Math.max(0.001, transition));
    local.current.visible = transition > 0.005;
    if (localFill.current) localFill.current.intensity = transition * 0.85;
    renderedTarget.current.x = motion ? MathUtils.damp(renderedTarget.current.x, s.localX, 5, dt) : s.localX;
    renderedTarget.current.z = motion ? MathUtils.damp(renderedTarget.current.z, s.localZ, 5, dt) : s.localZ;
    const radius = 8;
    const horizontal = Math.cos(s.localPitch) * radius;
    const localX = renderedTarget.current.x + Math.sin(s.localYaw) * horizontal;
    const localZ = renderedTarget.current.z + Math.cos(s.localYaw) * horizontal;
    const localY = Math.sin(s.localPitch) * radius;
    const targetX = MathUtils.lerp(0, localX, transition);
    const targetZ = MathUtils.lerp(distance, localZ, transition);
    const targetY = MathUtils.lerp(1.3, localY, transition) + Math.sin(Math.PI * transition) * 2.5;
    const targetLens = MathUtils.lerp(lensZoom, 1.15, transition);
    camera.position.x = motion ? MathUtils.damp(camera.position.x, targetX, sceneConfig.cameraDamping, dt) : targetX;
    camera.position.z = motion ? MathUtils.damp(camera.position.z, targetZ, sceneConfig.cameraDamping, dt) : targetZ;
    camera.position.y = motion ? MathUtils.damp(camera.position.y, targetY, sceneConfig.cameraDamping, dt) : targetY;
    camera.zoom = motion ? MathUtils.damp(camera.zoom, targetLens, sceneConfig.cameraDamping, dt) : targetLens;
    camera.updateProjectionMatrix();
    camera.lookAt(renderedTarget.current.x * transition, MathUtils.lerp(0.18, 0.2, transition), renderedTarget.current.z * transition);
  });
  return <group ref={root}><ambientLight ref={localFill} intensity={0} color="#fff0d5" /><group ref={spin}>{children}</group><group ref={local}>{landscape}</group></group>;
}
