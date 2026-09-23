# Future Control implementation plan

**Goal:** Turn archived 48-hour forecasts into a reviewable maintenance recommendation and a live turbine-off scenario.

**Source brief:** User-provided WindOS concept, 23 September 2026. The requested demo follows one narrative: ask for a four-hour stop, inspect the best window, test turbine-off, and explain the choice.

**Boundaries:** Forecast values remain the existing model outputs. A shutdown subtracts only the stopped turbine's forecast; no wake effect, production in MWh, calibrated confidence interval, or agent autonomy is claimed without data and validation. Decisions are planning support, not turbine control.

**Architecture:** Pure operator functions enumerate contiguous windows within the selected archived issue, rank lost normalized turbine-hours, calculate a comparison window, and summarize forecast changes. React displays their structured result, updates the shared timeline, and passes a scenario state to the 3D turbines. The existing assistant recognizes one maintenance request pattern and opens the same decision view.

**Verification:** Unit tests for edge windows, invalid duration, missing turbine, zero output, comparison, and forecast revision. UI tests for opening the decision, changing duration/turbine, activating a scenario, timeline synchronization, and assistant request. Run frontend tests, typecheck, build, Python tests, and diff check.

## Tasks

- [x] Write failing domain tests for window ranking, alternatives, and scenario output.
- [x] Implement the pure maintenance planner and pass its tests.
- [x] Write failing tests for forecast event and revision summaries; implement them.
- [x] Write failing UI tests for a visible Future Control flow and assistant request.
- [x] Add the Future Control panel, shared state, and honest explanatory copy.
- [x] Pass scenario state to the 3D turbine renderers so the chosen turbine stops only in its window.
- [ ] Update user documentation and run full verification.
