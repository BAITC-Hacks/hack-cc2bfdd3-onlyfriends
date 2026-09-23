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

If parallel DOM tests time out on a resource-constrained machine, run the unchanged suite in one worker: `node node_modules/vitest/vitest.mjs run --maxWorkers=1`.

## Explore

- Use **Overview / Turbines** to switch between the planet and the turbine table. The table is directly accessible at `/#turbines`; browser Back/Forward also switches views. It uses the existing **six** turbines, not the 32 illustrative entries in the reference image.
- On **Turbines**, search by ID/name, filter Active/Warning/Offline, sort by wind/power/name, or show Selected only. Checkboxes and removable chips share selection with the planet. The header checkbox selects/deselects only the current visible page and preserves selections hidden by filters.
- **Aggregate / Individual** switches the selected forecast summary. **View selected in 3D** returns to the planet with the same highlighted turbines and forecast hour. Clearing the selection restores whole-farm metrics in Overview; the table explicitly shows zero selected.
- Drag the planet or focus its canvas and use arrow keys. Release to coast; reset restores the initial view.
- Select a white turbine or its weather marker to inspect it. The turbine dropdown provides keyboard access, including turbines on the back of the planet.
- Zoom continuously with the mouse wheel, trackpad scroll/pinch, or a two-finger touch pinch. Focus the canvas and use +/− for keyboard zoom. The 1×–5× buttons are animated presets; gestures remain continuous between them. Reset restores rotation and 1× zoom.
- Metrics sit in a compact card on the right. Turbine selection adds a smaller contextual card. The layout uses one viewport (100vh/100dvh) with no page scrolling; only opened content popovers may scroll internally.
- Scrub or play the compact 24/48-hour timeline. Output, weather, procedural blade speeds, temperature, lighting and UI tone share the selected hour. Times are shown in UTC+5.
- Change the forecast date beside the AI command bar to explore winter, spring, summer and autumn. The 48-hour mock forecast regenerates for that date; temperature changes seasonally. Northern-hemisphere meteorological seasons and stylized time windows are used, not astronomical sunrise calculations.
- Show/hide weather or disable ambient motion in Display settings. OS reduced-motion preferences are respected; transitions become immediate when motion is disabled.
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
| `src/forecast/environment.ts` | Timestamp → UTC+5 hour, season and day/night state |
| `src/scene/config.ts` | Tree/turbine scale, float, inertia, zoom limits, camera/environment damping, marker height, model paths |
| `src/scene/interaction.ts` | Wheel/pinch/keyboard gestures, drag-versus-click handling, responsive safe camera framing |
| `src/scene/PlanetInteraction.tsx` | Inertial object rotation and damped camera travel/optical zoom |
| `src/scene/SeasonalEnvironment.tsx` | Persistent shared terrain/foliage/snow materials interpolated across seasons |
| `src/scene/DynamicLighting.tsx` | Interpolated ambient, fill and moving sun/moon key light |
| `src/scene/SkyController.tsx` | Interpolated scene background and lightweight fog |
| `src/scene/environmentPresets.ts` | Seasonal terrain/foliage and time-of-day lighting palettes |
| `src/scene/Planet.tsx` | Faceted terrain, deterministic tree distribution, low-poly clouds |
| `src/scene/Turbine.tsx` | Local surface alignment, rotor, selection, camera-facing occluded HTML markers |
| `src/components/` | Metrics, timeline, assistant, and display controls |
| `src/turbines/` | Turbine page, filtering/sorting/pagination, table, shared selection helpers and summary |

Zoom is bounded to 0.72×–5×. Camera travel stops at a safe distance and further magnification uses the perspective camera's optical zoom; high magnification intentionally shows a close-up rather than fitting the whole planet. Trees are 48% of their previous size and turbines are 165%; bases remain oriented to the surface normal. The conceptual coordinates, capacities and weather values are illustrative. Replace forecast fixtures with validated backend data to integrate the Python pipeline.

Seasonal changes update shared materials and fade lightweight snow patches without remounting the planet. Night is 21:00–05:59, sunrise 06:00–08:59, day 09:00–17:59, and sunset 18:00–20:59 (UTC+5). Ambient/fill lighting preserves turbine visibility at night. Scene and UI colors transition as the timeline changes. Imported Earth models retain their own materials; seasonal terrain tint applies to the procedural sphere, while vegetation, snow and lighting apply to both modes.

The scene is lazy-loaded; DOM controls remain usable if WebGL or a model fails. The app requires WebGL for 3D; Google Fonts are optional, with local sans-serif fallbacks. No third-party Earth asset or remote environment map is used.

Demo availability is defined on the turbine fixtures: T01–T04 are Active, T05 has a maintenance Warning, and T06 is Offline. The offline turbine has zero forecast output and stopped blades; its external weather forecast remains available. These statuses are illustrative, not live telemetry. The table supports eight rows per page; six fixtures occupy one page. On narrow/short screens, the table scrolls internally while the shared timeline and command bar stay within the viewport.

## Validation

Tests exercise forecast/date validation, UTC+5 season boundaries, day/night states, surface normals, selection, horizon clamping, playback, all zoom presets, wheel/pinch/keyboard handlers, camera safety, assistant responses, and reduced-motion defaults. Table coverage includes combined filters, sorting, empty/missing data, pagination boundaries, bulk/hidden selection, aggregate/individual summaries, offline output and selection/time transfer to 3D. DOM tests mock the canvas; they do not establish visual/WebGL correctness. Manually inspect desktop/mobile rendering, high-zoom rotation, seasonal transitions, imported models and marker occlusion in a WebGL browser.

API references: [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction), [drei useGLTF](https://drei.docs.pmnd.rs/loaders/gltf-use-gltf).
