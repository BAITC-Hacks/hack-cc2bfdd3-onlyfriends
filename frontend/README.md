# OnlyFriends · February wind forecast

React + TypeScript + Vite interface for the two wind turbines near Shelek. The planet and local terrain use React Three Fiber. Forecast and weather data are bundled from archived Python pipeline outputs; the site needs no backend or API key. In the local 3D view, animated wind also reads the selected ECMWF model run from Open-Meteo. The assistant answers a few forecast questions locally and is labeled as a demo.

## Run

Requires Node.js 22.14+ and npm.

```sh
cd frontend
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Production checks: `npm test`, `npm run typecheck`, `npm run build`.

## Explore

- Select either turbine above the globe. The selection is shared with the turbine table and analytics.
- Use 1×–5× zoom, trackpad pinch, keyboard +/−, or a two-finger pinch. At high zoom the globe transitions to a local 3D terrain view. Drag moves across the terrain; Shift-drag or right-drag orbits the camera. Arrow keys or WASD also move it. On touch, horizontal drag or two-finger pan moves the terrain. Normal wheel scrolling and vertical touch swipes move down to analytics.
- Choose a February issue date and a 24- or 48-hour horizon. The timeline, 3D turbine blades, metrics, and assistant use the same archived hourly forecast.
- Select **Future Control** to plan a turbine stop. The default searches all 21 four-hour windows fully inside tomorrow's Almaty calendar day, using the selected 48-hour issue. Change turbine, duration, or search period. It shows the lowest predicted loss, a non-overlapping alternative, the largest change against the prior issue, and notable forecast events. You can also ask the demo assistant: “Tomorrow I need to stop turbine 2 for four hours. Find the best window.”
- Select **Simulate shutdown** to stop that turbine during the chosen window. The 3D rotor stops and forecast output in the timeline, metrics, and selected-issue analytics changes to a what-if view. **Clear** restores the archived forecast.
- Scroll below the assistant, or select **Analytics**, for six forecast charts and an hourly table. Switch between the selected issue and all 672 February hours. Table columns include changes from the previous hour and from 24 hours earlier.
- **Turbines** shows both coordinate-specific forecasts, with search, sort, shared selection, and a return to the 3D view.

Predicted power is normalized per turbine from 0 to 1. It is not MW. No February actual generation data is bundled, so the interface does not claim forecast accuracy or production energy. Times are displayed in Asia/Almaty (UTC+5).

Future Control ranks windows by the sum of the stopped turbine's hourly normalized forecasts. The sum is **normalized turbine-hours**, not MWh. The displayed percentage compares the predicted loss against one non-overlapping alternative; it is not a measured saving. The shutdown scenario changes only the stopped turbine's output. It does not rerun the ML model, model wakes, or operate a real turbine. Per-hour prediction intervals are not calibrated; forecast revision and hour explanations show observed forecast changes, not causal attribution. The request parser supports a narrow maintenance command shape and is labeled as a demo, not a live AI service.

## Data and sources

`src/data/february2026.json` is generated from `artifacts/february_latest_forecast.csv`, `artifacts/backtest_2026-01-31_2026-02-28.csv`, and the matching archived `artifacts/weather/*.json` using `scripts/export_frontend_data.py`. The month view takes the latest forecast for each February hour. The 24/48-hour view takes one selected archived issue. Weather fields are aligned by valid UTC hour and turbine.

`src/data/shelek-terrain.json` is a baked elevation grid for the turbine site and surrounding mountains, plus mapped waterways and tracks. `scripts/export_terrain.py` fetches the [Mapzen Terrain Tiles public dataset](https://registry.opendata.aws/terrain-tiles/) and [OpenStreetMap](https://www.openstreetmap.org/copyright) map data. The browser loads the local file without a map key. Field, soil, grass, and bank colors are artistic treatments of the terrain, not verified land cover or measured river width.

The local wind animation fetches 100 m speed and direction from the [Open-Meteo Single Runs API](https://open-meteo.com/en/docs/single-runs-api) when the terrain view opens. The `runTime` stored with each February issue ensures the request uses that issue's ECMWF forecast run. The response is cached for hour scrubbing, validated, and limited to 12 seconds. If the API fails, the animation uses bundled weather and the on-screen badge names the fallback.

The local `artifacts/weather/` cache is required only when regenerating the forecast JSON. Regenerate from the repository root with:

```sh
uv run python scripts/export_frontend_data.py --latest artifacts/february_latest_forecast.csv --backtest artifacts/backtest_2026-01-31_2026-02-28.csv --weather-dir artifacts/weather --output frontend/src/data/february2026.json
uv run python scripts/export_terrain.py
```

The terrain script needs network access and Pillow. The map data and forecast JSON are already bundled for normal development.

## Verification limits

Automated DOM tests mock the 3D canvas. Run the app in a WebGL browser to inspect scene appearance and transitions. The optional supplied turbine GLB is available in Display settings; the procedural turbine remains the default.
