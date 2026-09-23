"""One bounded LangGraph workflow for an hourly wind-power forecast issue."""

from dataclasses import dataclass
from datetime import datetime, timedelta
import os
from pathlib import Path
from typing import Callable, TypedDict

from langchain_core.runnables import RunnableLambda
from langchain_core.tracers.langchain import LangChainTracer
from langgraph.graph import END, START, StateGraph
from langsmith import Client, tracing_context
import pandas as pd
from typing_extensions import NotRequired

from windpower import agent_tools, features, forecast, operations, source_search, store
from windpower.weather_provider import OpenMeteoWeatherProvider, WeatherProvider


WeatherFetcher = Callable[[datetime], pd.DataFrame]
PowerPredictor = Callable[[pd.DataFrame], pd.DataFrame]
WebSearcher = Callable[[str], source_search.SearchReport]
MAX_DAILY_ISSUES = 29


class ForecastState(TypedDict):
    issue_input: datetime
    mode: str
    target_start_input: NotRequired[datetime]
    preloaded_weather: NotRequired[pd.DataFrame]
    events: list[dict[str, str]]
    issue: NotRequired[datetime]
    weather: NotRequired[pd.DataFrame]
    checked_weather: NotRequired[pd.DataFrame]
    features: NotRequired[pd.DataFrame]
    prediction: NotRequired[pd.DataFrame]
    forecast: NotRequired[pd.DataFrame]
    analysis: NotRequired[dict[str, dict[str, float | int]]]
    operations: NotRequired[dict]
    saved: NotRequired[tuple[str, Path]]
    error_code: NotRequired[str]
    error_message: NotRequired[str]


ForecastSaver = Callable[[ForecastState], tuple[str, Path]]


@dataclass(frozen=True)
class AgentResult:
    status: str
    run_id: str | None
    artifact_path: Path | None
    forecast: pd.DataFrame | None
    events: tuple[dict[str, str], ...]
    error_code: str | None = None
    error_message: str | None = None
    analysis: dict[str, dict[str, float | int]] | None = None
    operations: dict | None = None


class ForecastAgent:
    """Fetch one archived weather run, predict, check, and save 48 hourly values."""

    STEPS = (
        ("validate_request", "INVALID_REQUEST", "issue"),
        ("fetch_weather_run", "WEATHER_ERROR", "weather"),
        ("validate_inputs", "INVALID_WEATHER", "checked_weather"),
        ("build_features", "FEATURE_ERROR", "features"),
        ("predict_power", "MODEL_ERROR", "prediction"),
        ("validate_forecast", "INVALID_FORECAST", "forecast"),
        ("analyze_forecast", "ANALYSIS_ERROR", "analysis"),
        ("assess_operations", "ANALYSIS_ERROR", "operations"),
        ("save_forecast", "SAVE_ERROR", "saved"),
    )

    def __init__(
        self,
        predictor: PowerPredictor,
        model_version: str,
        cache_dir: Path,
        output_dir: Path,
        weather_fetcher: WeatherFetcher | None = None,
        web_searcher: WebSearcher | None = None,
        saver: ForecastSaver | None = None,
        weather_provider: WeatherProvider | None = None,
    ) -> None:
        if not callable(predictor) or not model_version.strip():
            raise ValueError("a callable trained model and nonempty model version are required")
        self.model_version = model_version
        self.output_dir = Path(output_dir)
        self.provider = weather_provider or OpenMeteoWeatherProvider(Path(cache_dir))
        self.fetch_weather = weather_fetcher or (
            self.provider.get_historical_forecast
        )
        self.predictor = RunnableLambda(predictor, name="predict_power")
        self.saver = saver

        self.weather_tool = agent_tools.make_weather_tool(self.fetch_weather)
        self.search_tool = agent_tools.make_search_tool(web_searcher or source_search.search_web)
        graph = StateGraph(ForecastState)
        actions = (
            lambda state: forecast.normalize_issue(state["issue_input"]),
            self._fetch_weather,
            lambda state: forecast.validate_weather(state["weather"], state["issue"], state["mode"], state.get("target_start_input")),
            lambda state: features.make_features(state["checked_weather"]),
            lambda state: self.predictor.invoke(state["features"]),
            lambda state: forecast.validate_prediction(state["prediction"], state["checked_weather"]),
            lambda state: forecast.analyze_prediction(state["forecast"]),
            lambda state: operations.assess_operations(state["forecast"]),
            self._save,
        )
        for (name, code, output), action in zip(self.STEPS, actions):
            graph.add_node(name, self._node(name, code, output, action))
        graph.add_edge(START, self.STEPS[0][0])
        for current, following in zip(self.STEPS, self.STEPS[1:]):
            graph.add_conditional_edges(
                current[0], self._route, {"continue": following[0], "stop": END}
            )
        graph.add_edge(self.STEPS[-1][0], END)
        self.graph = graph.compile()

    def run(self, issue_utc: datetime, mode: str = "historical",
            target_start_utc: datetime | None = None,
            preloaded_weather: pd.DataFrame | None = None) -> AgentResult:
        """Return a saved forecast or a classified failure with completed steps."""
        config = {"recursion_limit": len(self.STEPS) + 3}
        tracing = os.getenv("LANGSMITH_TRACING", "").lower() == "true"
        key = os.getenv("LANGSMITH_API_KEY", "")
        if tracing and key:
            client = Client(api_key=key, hide_inputs=True, hide_outputs=True, hide_metadata=True)
            config["callbacks"] = [
                LangChainTracer(client=client, project_name=os.getenv("LANGSMITH_PROJECT", "windpower-forecast"))
            ]
        # Suppress ambient tracing, which could publish raw graph state. The explicit
        # tracer above uses a client that removes inputs, outputs, and metadata.
        initial = {"issue_input": issue_utc, "mode": mode, "target_start_input": target_start_utc, "events": []}
        if preloaded_weather is not None:
            initial["preloaded_weather"] = preloaded_weather
        with tracing_context(enabled=False):
            state = self.graph.invoke(initial, config=config)
        if "error_code" in state:
            return AgentResult(
                "FAILED", None, None, None, tuple(state["events"]),
                state["error_code"], state["error_message"],
            )
        run_id, path = state["saved"]
        return AgentResult(
            "SUCCESS", run_id, path, state["forecast"], tuple(state["events"]),
            analysis=state["analysis"], operations=state["operations"],
        )

    def research_sources(self, query: str) -> source_search.SearchReport:
        """Search current public pages without adding results to forecast state."""
        with tracing_context(enabled=False):
            return self.search_tool.invoke({"query": query})

    def _fetch_weather(self, state: ForecastState) -> pd.DataFrame:
        if "preloaded_weather" in state:
            return state["preloaded_weather"]
        if state["mode"] == "historical":
            return self.weather_tool.invoke({"issue_time_utc": state["issue"].isoformat()})
        if state["mode"] == "live":
            return self.provider.get_forecast(state["issue"], state.get("target_start_input"))
        raise ValueError("mode must be historical or live")

    def run_daily(self, first_issue_utc: datetime, last_issue_utc: datetime) -> tuple[AgentResult, ...]:
        """Run at the same UTC hour each day, stopping at the first failed issue."""
        first = forecast.normalize_issue(first_issue_utc)
        last = forecast.normalize_issue(last_issue_utc)
        seconds = (last - first).total_seconds()
        if seconds < 0 or seconds % timedelta(days=1).total_seconds():
            raise ValueError("daily issues must be an inclusive range at one UTC hour")
        count = int(seconds // timedelta(days=1).total_seconds()) + 1
        if count > MAX_DAILY_ISSUES:
            raise ValueError(f"daily replay is limited to {MAX_DAILY_ISSUES} issues")
        results = []
        for index in range(count):
            result = self.run(first + timedelta(days=index))
            results.append(result)
            if result.status != "SUCCESS":
                break
        return tuple(results)

    @staticmethod
    def _route(state: ForecastState) -> str:
        return "stop" if "error_code" in state else "continue"

    @staticmethod
    def _node(
        name: str, code: str, output: str, action: Callable[[ForecastState], object]
    ) -> Callable[[ForecastState], dict]:
        def execute(state: ForecastState) -> dict:
            try:
                value = action(state)
            except Exception as error:
                message = str(error) if isinstance(error, ValueError) else f"{name} failed: {type(error).__name__}"
                return {
                    "events": [*state["events"], {"step": name, "status": "FAILED", "error_code": code}],
                    "error_code": code,
                    "error_message": message,
                }
            return {
                output: value,
                "events": [*state["events"], {"step": name, "status": "SUCCESS"}],
            }

        return execute

    def _save(self, state: ForecastState) -> tuple[str, Path]:
        if self.saver is not None:
            return self.saver(state)
        events = [*state["events"], {"step": "save_forecast", "status": "SUCCESS"}]
        return store.save_run(
            pd.Timestamp(state["issue"]), state["checked_weather"], state["forecast"],
            self.model_version, state["analysis"], state["operations"], events, self.output_dir, state["mode"],
            state.get("target_start_input"),
        )
