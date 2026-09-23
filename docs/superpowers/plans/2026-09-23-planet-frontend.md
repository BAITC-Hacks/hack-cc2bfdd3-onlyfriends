# Interactive wind planet implementation plan

**Goal:** Implement the user's specified React + TypeScript + Vite wind forecast frontend.
**Architecture:** An independent `frontend/` app; typed deterministic demo forecasts feed UI and scene. Procedural terrain, surface-normal placement, and replaceable GLTF components keep rendering separate from forecast logic. Existing Python code remains intact.
**Design:** Warm white canvas, charcoal typography, forest-green accents, restrained glass panels, central floating eco planet, right metrics, bottom timeline and demo assistant. Responsive layout and reduced-motion support.

1. Scaffold Vite/React/TypeScript and test runner. Add forecast and spherical placement tests before implementation.
2. Implement typed 48-hour demo series, selected turbine/hour state, metrics, accessible timeline and local demo search.
3. Implement faceted green planet, radial trees/turbines, clouds, camera-facing weather labels, drag inertia, float, animated 1x/2x camera.
4. Add GLTF adapters and supplied static asset option, plus model contract documentation.
5. Verify tests, TypeScript/production build, browser rendering and interactions; document exact results and setup.

Review focus: surface placement must prevent buried towers; horizon changes must clamp selection; dragging must not select a turbine; asset/WebGL failures must be visible; reduced motion must stop decorative animation.

## Execution evidence

- Implemented the independent frontend, original scene geometry, model adapters, supplied model toggle, connected controls, and README.
- Ruling: retain the supplied asset as an opt-in static model because its single mesh has no independently animatable rotor. Default procedural turbines satisfy wind-driven rotation.
- Forecast and placement tests: 8 passed. DOM interaction tests: 6 passed. TypeScript passed.
- Static independent review identified a zoom multiplier mismatch and low secondary text contrast; both corrected.
- Initial production build passed with the expected large lazy 3D chunk warning; final rebuild includes review corrections.
- Browser verification blocked: no browser providers were connected. Canvas appearance, mobile rendering, drag hit-testing, and model appearance remain visually unverified. DOM tests explicitly mock the scene.
