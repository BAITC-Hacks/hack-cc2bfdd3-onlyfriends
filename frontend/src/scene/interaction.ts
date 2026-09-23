import { sceneConfig } from './config';

export const clampZoom = (zoom: number) => Math.min(sceneConfig.maxZoom, Math.max(sceneConfig.minZoom, zoom));
export function fitDistance(aspect: number) {
  const halfFov = 38 * Math.PI / 360;
  return Math.max(sceneConfig.cameraDistance, sceneConfig.frameRadius / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(1, aspect))));
}
/** Combine limited camera travel with optical zoom so 5x cannot enter the terrain. */
export function cameraFraming(aspect: number, zoom: number) {
  const safeZoom = clampZoom(zoom);
  const dolly = Math.min(safeZoom, sceneConfig.maxCameraDolly);
  return { distance: fitDistance(aspect) / dolly, lensZoom: safeZoom / dolly };
}
export function createInteraction() {
  return { down: false, pitch: 0.08, yaw: -0.22, vx: 0, vy: 0, zoom: 1,
    localX: 0, localZ: 0, localYaw: -2.4, localPitch: 0.7 };
}
export type Interaction = ReturnType<typeof createInteraction>;

function panLocal(state: Interaction, dx: number, dy: number) {
  const distance = 0.012;
  const rightX = Math.cos(state.localYaw), rightZ = -Math.sin(state.localYaw);
  const forwardX = -Math.sin(state.localYaw), forwardZ = -Math.cos(state.localYaw);
  state.localX = Math.max(-14, Math.min(14, state.localX - dx * distance * rightX + dy * distance * forwardX));
  state.localZ = Math.max(-14, Math.min(14, state.localZ - dx * distance * rightZ + dy * distance * forwardZ));
}

/** One gesture owner prevents pinch from fighting rotation; capture keeps drags on-canvas. */
export function bindPlanetGestures(canvas: HTMLCanvasElement, state: Interaction, onZoom?: (zoom: number) => void) {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;
  let travel = 0;
  let suppressClick = false;
  let orbitLocal = false;
  let pinchMidpoint: { x: number; y: number } | null = null;
  function zoomTo(zoom: number) { state.zoom = clampZoom(zoom); onZoom?.(state.zoom); }
  const distance = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const midpoint = () => { const [a, b] = [...pointers.values()]; return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null; };
  function down(e: PointerEvent) {
    if (e.button !== 0 && !(state.zoom > 3.2 && e.button === 2)) return;
    if (!pointers.size) { suppressClick = false; travel = 0; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    state.down = true; state.vx = 0; state.vy = 0;
    orbitLocal = state.zoom > 3.2 && (e.shiftKey || e.button === 2);
    if (pointers.size > 1) { pinchDistance = distance(); pinchMidpoint = midpoint(); suppressClick = true; }
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
  function move(e: PointerEvent) {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    const dx = e.clientX - previous.x, dy = e.clientY - previous.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size > 1) {
      const next = distance();
      if (pinchDistance > 0 && next > 0) zoomTo(state.zoom * next / pinchDistance);
      const center = midpoint();
      if (state.zoom > 3.2 && center && pinchMidpoint) panLocal(state, center.x - pinchMidpoint.x, center.y - pinchMidpoint.y);
      pinchMidpoint = center;
      pinchDistance = next;
      return;
    }
    travel += Math.hypot(dx, dy);
    suppressClick ||= travel > 5;
    if (state.zoom > 3.2) {
      if (orbitLocal) {
        state.localYaw -= dx * 0.008;
        state.localPitch = Math.max(0.25, Math.min(1.18, state.localPitch + dy * 0.006));
      } else panLocal(state, dx, dy);
      return;
    }
    state.vx = dx * sceneConfig.dragSensitivity;
    state.vy = dy * sceneConfig.dragSensitivity;
    state.yaw += state.vx;
    state.pitch = Math.max(-0.75, Math.min(0.75, state.pitch + state.vy));
  }
  function up(e: PointerEvent) {
    pointers.delete(e.pointerId);
    state.down = pointers.size > 0;
    pinchDistance = distance();
    pinchMidpoint = midpoint();
    canvas.style.cursor = state.down ? 'grabbing' : 'grab';
  }
  function wheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.shiftKey) return;
    e.preventDefault();
    const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight || 600 : 1;
    zoomTo(state.zoom * Math.exp(-e.deltaY * units * sceneConfig.zoomSensitivity * (e.ctrlKey ? 2 : 1)));
  }
  function key(e: KeyboardEvent) {
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] };
    const localOffsets: Record<string, [number, number]> = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, 35], ArrowDown: [0, -35], w: [0, 35], a: [-35, 0], s: [0, -35], d: [35, 0] };
    if (state.zoom > 3.2 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(e.key)) {
      e.preventDefault();
      const [dx, dy] = localOffsets[e.key];
      if (e.shiftKey) state.localYaw -= dx * 0.008;
      else panLocal(state, dx, dy);
    } else if (offsets[e.key]) { e.preventDefault(); state.yaw += offsets[e.key][0]; state.pitch = Math.max(-0.75, Math.min(0.75, state.pitch + offsets[e.key][1])); }
    if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); zoomTo(state.zoom * (e.key === '-' ? 1 / 1.15 : 1.15)); }
  }
  function click(e: MouseEvent) { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); } }
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive planet and terrain. On terrain drag or use arrows to move, shift-drag to orbit. Pinch or control-scroll to zoom. Scroll down for analytics.');
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', key); canvas.addEventListener('click', click, true);
  const contextMenu = (e: MouseEvent) => { if (state.zoom > 3.2) e.preventDefault(); };
  canvas.addEventListener('contextmenu', contextMenu);
  return () => {
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); canvas.removeEventListener('lostpointercapture', up);
    canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('keydown', key); canvas.removeEventListener('click', click, true);
    canvas.removeEventListener('contextmenu', contextMenu);
    pointers.clear(); state.down = false;
  };
}
