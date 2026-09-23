// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bindPlanetGestures, createInteraction, clampZoom, fitDistance, cameraFraming, localCameraRadius } from './interaction';

function setup() {
  const canvas = document.createElement('canvas');
  canvas.setPointerCapture = vi.fn();
  const state = createInteraction();
  const dispose = bindPlanetGestures(canvas, state);
  function pointer(type: string, id: number, x: number, y: number, shiftKey = false) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0, shiftKey });
    canvas.dispatchEvent(event);
  }
  return { canvas, state, dispose, pointer };
}
describe('continuous planet gestures', () => {
  it('leaves wheel scrolling for analytics, but uses trackpad pinch to zoom the scene', () => {
    const { canvas, state, dispose } = setup();
    const wheel = new WheelEvent('wheel', { deltaY: -100, cancelable: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(state.zoom).toBe(1);
    const pinch = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true });
    canvas.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
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
  it('keeps the camera outside the planet at the globe-to-terrain transition', () => {
    const base = fitDistance(2);
    const framing = cameraFraming(2, 5);
    expect(framing.distance).toBeGreaterThan(3.7);
    expect(base / framing.distance * framing.lensZoom).toBeCloseTo(5);
    expect(clampZoom(100)).toBe(12);
  });
  it('moves the local camera closer after 5x while retaining clearance', () => {
    expect(localCameraRadius(5)).toBeCloseTo(8);
    expect(localCameraRadius(8)).toBeLessThan(localCameraRadius(5));
    expect(localCameraRadius(12)).toBeGreaterThan(1.8);
    expect(localCameraRadius(12)).toBeLessThan(2.5);
  });
  it('pans the local terrain by dragging and orbits it with shift-drag', () => {
    const { state, pointer, dispose } = setup();
    state.zoom = 5;
    const globeYaw = state.yaw;
    pointer('pointerdown', 1, 100, 100);
    pointer('pointermove', 1, 160, 130);
    pointer('pointerup', 1, 160, 130);
    expect(Math.abs(state.localX) + Math.abs(state.localZ)).toBeGreaterThan(0.1);
    expect(state.yaw).toBe(globeYaw);
    const azimuth = state.localYaw;
    pointer('pointerdown', 2, 100, 100, true);
    pointer('pointermove', 2, 150, 100, true);
    expect(state.localYaw).not.toBe(azimuth);
    dispose();
  });
  it('moves through the local terrain with arrow keys without rotating the globe', () => {
    const { canvas, state, dispose } = setup();
    state.zoom = 5;
    const globeYaw = state.yaw;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
    expect(Math.abs(state.localX) + Math.abs(state.localZ)).toBeGreaterThan(0);
    expect(state.yaw).toBe(globeYaw);
    dispose();
  });
});
