// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindPlanetGestures, createInteraction, clampZoom, fitDistance, cameraFraming } from './interaction';

function setup() {
  const canvas = document.createElement('canvas');
  canvas.setPointerCapture = vi.fn();
  const state = createInteraction();
  const dispose = bindPlanetGestures(canvas, state);
  function pointer(type: string, id: number, x: number, y: number) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0 });
    canvas.dispatchEvent(event);
  }
  return { canvas, state, dispose, pointer };
}
describe('continuous planet gestures', () => {
  it('zooms continuously with wheel and trackpad pinch, prevents page zoom, and clamps limits', () => {
    const { canvas, state, dispose } = setup();
    const wheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(state.zoom).toBeGreaterThan(1);
    expect(state.zoom).toBeLessThan(2);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -10000, ctrlKey: true }));
    expect(state.zoom).toBe(clampZoom(100));
    expect(clampZoom(-1)).toBeGreaterThan(0);
    dispose();
    const zoom = state.zoom;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    expect(state.zoom).toBe(zoom);
  });
  it('pinches without rotating, resumes one-finger dragging without a jump, and suppresses selection', () => {
    const { canvas, state, pointer, dispose } = setup();
    pointer('pointerdown', 1, 0, 0); pointer('pointerdown', 2, 100, 0);
    const yaw = state.yaw;
    pointer('pointermove', 2, 200, 0);
    expect(state.zoom).toBe(2);
    expect(state.yaw).toBe(yaw);
    pointer('pointerup', 2, 200, 0);
    pointer('pointermove', 1, 10, 0);
    expect(state.yaw - yaw).toBeCloseTo(0.06);
    const click = new MouseEvent('click', { cancelable: true });
    canvas.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    pointer('pointercancel', 1, 10, 0);
    expect(state.down).toBe(false);
    dispose();
  });
  it('fits the model on portrait screens and supports keyboard zoom', () => {
    expect(fitDistance(0.5)).toBeGreaterThan(fitDistance(2));
    const { canvas, state, dispose } = setup();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(state.zoom).toBeGreaterThan(1);
    dispose();
  });
  it('keeps the camera outside the planet even at 5x', () => {
    const base = fitDistance(2);
    const framing = cameraFraming(2, 5);
    expect(framing.distance).toBeGreaterThan(3.7);
    expect(base / framing.distance * framing.lensZoom).toBeCloseTo(5);
    expect(clampZoom(100)).toBe(5);
  });
});
