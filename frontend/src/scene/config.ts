export const sceneConfig = {
  floatAmplitude: 0.065,
  floatSpeed: 1.25,
  idleRotation: 0.025,
  dragSensitivity: 0.006,
  inertiaDamping: 5,
  cameraDistance: 8.8,
  cameraZoom: 2,
  cameraDamping: 4,
  bladeSpeed: 0.24,
  weatherHeight: 1.2,
  // Change to '/models/earth.glb' to replace the procedural sphere.
  earthModel: null as string | null,
  // Change to '/models/turbine.glb' to replace procedural turbines by default.
  turbineModel: null as string | null,
};
