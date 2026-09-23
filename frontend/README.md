# OnlyFriends wind forecast dashboard

The React, TypeScript, Vite and React Three Fiber dashboard reads validated 48-hour forecasts from the Python API. It renders the two configured turbine coordinates. The scene never computes power; it uses normalized output from the trained model and archived or current weather from the server.

## Run

From the repository root:

```powershell
uv sync
uv run python -m windpower.api
```

The API loads `artifacts/model/model.joblib` by default. Override this trusted local path with `WINDPOWER_MODEL_PATH` if needed. The bundle must contain the fitted windpower model and its training metadata. For the 31 January 2026 historical issue, the API selects the earlier immutable model version. Without a compatible model, it returns `MODEL_UNAVAILABLE` and the dashboard shows no forecast values. Joblib files must come from a trusted source.

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Vite forwards `/api` to `127.0.0.1:8000`. `npm test`, `npm run typecheck`, and `npm run build` validate the frontend. `uv run --group dev pytest -q` validates Python.

## Modes and controls

- Live forecast is the default view and uses the current ECMWF endpoint. Leave the start date empty for the next 48 hours, or choose a future UTC date within the available window. The backend records retrieval time without claiming the current model initialization time.
- Historical replay selects one daily issue at `00:00 Asia/Almaty` between 31 January and 28 February 2026. This calendar is limited to the hackathon evaluation period. It requests an archived ECMWF forecast run. The source provides model initialization time, while the seven-hour publication lag is an estimate; exact historical availability is not proven by the provider.
- The timeline switches between 24 and 48 hours and selects one hour from the downloaded series. Playback never refetches weather. The card, graph and turbine scene share that hour.
- The Turbines tab lists the two API sites for the selected hour. Search, sorting, selection, and the summary use the same downloaded forecast; the table shows normalized power as a percentage, never MW. Selecting a turbine in the table also highlights it on the planet.
- The 3D scene changes its lighting and colors with the selected forecast hour and local season. Drag to rotate, scroll or pinch to zoom, or use the 1×–5× buttons. These effects are visual context, not additional weather observations.
- Power in the card and graph is normalized line-side power. With both points selected, the chart and card show their mean normalized value. No MW, MWh, rated capacity, or forecast confidence is inferred.
- The assistant sends questions to `/api/ask` with the selected forecast run, hour, turbine, and visible horizon. The Python server loads that saved run. Peak normalized power is calculated directly from its hourly values; other natural-language questions use `OPENAI_API_KEY` from `.env` or the environment. Replies are kept short, and the key never goes to the browser. For wind-cause questions it also retrieves sea-level pressure at five nearby ECMWF grid points. Historical questions use the archived run saved with the forecast; live regional context is fetched separately and marked as an unverified run match. Pressure differences support a possible physical explanation, but cannot prove a specific front, cyclone, or terrain effect.

The procedural turbine rotor speed is a bounded visual mapping of forecast wind at 100 m, not physical RPM. Wind direction rotates the visual turbine; the card shows the source direction numerically. The supplied GLB in `public/models/supplied-turbine.glb` is one static mesh with no separate `Rotor` node, so its blades cannot animate independently. See `public/models/ATTRIBUTION.md` for attribution. Cloud and precipitation effects are omitted because those variables are not fetched.

The scene is lazy-loaded and requires WebGL. Tests mock the canvas; inspect appearance, placement, and pointer behavior in a WebGL browser separately.
