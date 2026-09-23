import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, MathUtils } from 'three';
import { sceneConfig } from './config';

export function PlanetInteraction({ children, motion, reset }: { children: ReactNode; motion: boolean; reset: number }) {
  const root = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const { gl } = useThree();
  const state = useRef({ down: false, pointerId: -1, x: 0, y: 0, pitch: 0.08, yaw: -0.22, vx: 0, vy: 0 });
  useEffect(() => { Object.assign(state.current, { pitch: 0.08, yaw: -0.22, vx: 0, vy: 0 }); }, [reset]);
  useEffect(() => {
    const canvas = gl.domElement;
    function down(e: PointerEvent) {
      if (e.button !== 0) return;
      Object.assign(state.current, { down: true, pointerId: e.pointerId, x: e.clientX, y: e.clientY, vx: 0, vy: 0 });
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    }
    function move(e: PointerEvent) {
      const s = state.current;
      if (!s.down || e.pointerId !== s.pointerId) return;
      s.vx = (e.clientX - s.x) * sceneConfig.dragSensitivity;
      s.vy = (e.clientY - s.y) * sceneConfig.dragSensitivity;
      s.yaw += s.vx; s.pitch = MathUtils.clamp(s.pitch + s.vy, -0.75, 0.75);
      s.x = e.clientX; s.y = e.clientY;
    }
    function up() { state.current.down = false; canvas.style.cursor = 'grab'; }
    function key(e: KeyboardEvent) {
      const offsets: Record<string, [number, number]> = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] };
      if (offsets[e.key]) { e.preventDefault(); state.current.yaw += offsets[e.key][0]; state.current.pitch = MathUtils.clamp(state.current.pitch + offsets[e.key][1], -0.75, 0.75); }
    }
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Interactive eco planet. Drag or use arrow keys to rotate.');
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up); canvas.addEventListener('keydown', key);
    return () => { canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('keydown', key); };
  }, [gl]);
  useFrame(({ clock }, delta) => {
    if (!root.current || !spin.current) return;
    const dt = Math.min(delta, 0.05), s = state.current;
    if (!s.down && motion) { s.yaw += s.vx * dt * 35 + dt * sceneConfig.idleRotation; s.pitch = MathUtils.clamp(s.pitch + s.vy * dt * 35, -0.75, 0.75); }
    s.vx *= Math.exp(-sceneConfig.inertiaDamping * dt); s.vy *= Math.exp(-sceneConfig.inertiaDamping * dt);
    spin.current.rotation.y = MathUtils.damp(spin.current.rotation.y, s.yaw, motion ? 10 : 100, dt);
    spin.current.rotation.x = MathUtils.damp(spin.current.rotation.x, s.pitch, motion ? 10 : 100, dt);
    root.current.position.y = motion ? Math.sin(clock.elapsedTime * sceneConfig.floatSpeed) * sceneConfig.floatAmplitude : 0;
    root.current.rotation.z = motion ? Math.sin(clock.elapsedTime * 0.55) * 0.017 : 0;
  });
  return <group ref={root}><group ref={spin}>{children}</group></group>;
}

export function CameraRig({ zoom, motion }: { zoom: 1 | 2; motion: boolean }) {
  useFrame(({ camera }, dt) => {
    const target = zoom === 1 ? sceneConfig.cameraDistance : sceneConfig.cameraDistance / sceneConfig.cameraZoom;
    camera.position.z = motion ? MathUtils.damp(camera.position.z, target, sceneConfig.cameraDamping, Math.min(dt, 0.05)) : target;
    camera.lookAt(0, 0.12, 0);
  });
  return null;
}
