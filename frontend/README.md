# OnlyFriends · Wind planet

A React + TypeScript + Vite concept dashboard with an original procedural eco planet, React Three Fiber, and drei. All forecasts and assistant responses are **local demo data**, with no backend or AI API connection.

## Run

Requires Node.js 22.14+ and npm.

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. From the workspace parent, first `cd hack-cc2bfdd3-onlyfriends`.

```sh
npm test          # Forecast, placement, and DOM interaction tests
npm run typecheck
npm run build    # TypeScript checks + production files in dist/
npm run preview  # Serve the production build
```

## Explore

- Drag the planet or focus its canvas and use arrow keys. Release to coast; reset restores the initial view.
- Select a white turbine or its weather marker to inspect it. The turbine dropdown provides keyboard access, including turbines on the back of the planet.
- Switch 1× / 2× camera framing, show/hide weather, or disable ambient motion in Display settings. OS reduced-motion preferences are respected.
- Scrub or play the 24/48-hour timeline. Output, weather, and procedural blade speeds share the selected hour. Times are shown in UTC+5.
- The bottom assistant answers peak-output and weather questions deterministically from the selected horizon. Unsupported questions receive an explicit demo limitation.

## Model swaps

`src/scene/config.ts` contains `earthModel` and `turbineModel`. Leave them `null` for procedural geometry, or set them to `/models/earth.glb` and `/models/turbine.glb` after adding those files to `public/models/`.

`ModelAsset.tsx` uses `useGLTF` and clones the cached scene per instance. Turbines must be **Y-up**, with blades facing local +Z. The adapter centers X/Z, puts the lowest point at the base, and normalizes total height. For rotating imported blades, separate the rotor as a node named **`Rotor`**, with its pivot at the hub and rotation axis along local Z. A static mesh cannot animate its blades independently.

The provided `assets/Wind turbine by Poly by Google - 8Tke6WIyZtg.glb` is copied unchanged to `public/models/supplied-turbine.glb`. Enable it in Display settings. It contains one static mesh and no animations; procedural animated turbines are the default. Original asset attribution is preserved in `public/models/ATTRIBUTION.md`.

Earth assets are centered and uniformly normalized to the procedural diameter. Use a spherical surface: `latLonToVector3()` and `surfacePlacement()` in `placement.ts` position objects radially and rotate local +Y onto the surface normal. Irregular imported terrain needs a raycast/height-sampling placement adapter; the current positive clearance guarantees above-surface bases for the procedural sphere.

## Tuning and structure

| File | Responsibility / tuning |
| --- | --- |
| `src/App.tsx` | Selected hour/turbine, playback, horizon, zoom, preferences |
| `src/forecast/forecast.ts` | Typed 48-hour fixtures, illustrative 3.6 MW turbine curve, aggregation, local assistant |
| `src/scene/config.ts` | Float amplitude/speed, inertia, camera distances/damping, blade speed, marker height, model paths |
| `src/scene/PlanetInteraction.tsx` | Pointer capture, inertial object rotation, camera transition, keyboard rotation |
| `src/scene/Planet.tsx` | Faceted terrain, deterministic tree distribution, low-poly clouds |
| `src/scene/Turbine.tsx` | Local surface alignment, rotor, selection, camera-facing occluded HTML markers |
| `src/components/` | Metrics, timeline, assistant, and display controls |

Camera zoom uses two presentation distances rather than browser scaling. The conceptual tree/turbine coordinates are decorative, not surveyed farm locations. Capacity, confidence, and all weather values are illustrative. Replace forecast fixtures with validated backend data to integrate the Python pipeline.

The scene is lazy-loaded; DOM controls remain usable if WebGL or a model fails. The app requires WebGL for 3D; Google Fonts are optional, with local sans-serif fallbacks. No third-party Earth asset or remote environment map is used.

## Validation

Tests exercise forecast boundaries, hourly coverage, surface normals, turbine selection, horizon clamping, playback/wrapping, zoom/settings state, assistant responses, and reduced-motion defaults. DOM tests mock the canvas; they do not establish visual/WebGL correctness. Manually inspect desktop and mobile rendering, drag-versus-click, imported model appearance, and marker occlusion in a WebGL browser.

API references: [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction), [drei useGLTF](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf).
