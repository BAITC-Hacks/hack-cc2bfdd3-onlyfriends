export const sceneConfig = {
  floatAmplitude: 0.065,
  floatSpeed: 1.25,
  idleRotation: 0.025,
  dragSensitivity: 0.006,
  inertiaDamping: 5,
  cameraDistance: 8.8,
  minZoom: 0.72,
  maxZoom: 5,
  maxCameraDolly: 1.7,
  zoomSensitivity: 0.002,
  frameRadius: 3.5,
  cameraDamping: 4,
  bladeSpeed: 0.24,
  turbineScale: 1.65,
  treeScale: 0.48,
  weatherHeight: 2.05,
  environmentDamping: 2.6,
  // Change to '/models/earth.glb' to replace the procedural sphere.
  earthModel: null as string | null,
  // Change to '/models/turbine.glb' to replace procedural turbines by default.
  turbineModel: null as string | null,
};
