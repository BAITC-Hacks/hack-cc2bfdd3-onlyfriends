"""Small HTTP bridge between the forecasting graph and the dashboard."""

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from windpower.agent import ForecastAgent
from windpower.forecast_qa import ForecastQuestionError, answer_forecast_question, load_forecast_run
from windpower.model_loader import ModelUnavailable, load_predictor
from windpower.regional_weather import fetch_regional_context
from windpower.weather import SITES


def forecast_document(mode: str, issue: datetime, model_path: Path,
                      cache_dir: Path, output_dir: Path,
                      target_start: datetime | None = None) -> tuple[int, dict]:
    """Run a real forecast and return the validated artifact as one UI document."""
    if mode not in {"historical", "live"}:
        return 400, {"status": "FAILED", "error_code": "INVALID_REQUEST", "message": "mode must be historical or live"}
    try:
        predictor, version = load_predictor(model_path, issue, mode)
    except ModelUnavailable as error:
        return 503, {"status": "FAILED", "error_code": "MODEL_UNAVAILABLE", "message": str(error)}
    agent = ForecastAgent(predictor, version, cache_dir, output_dir)
    result = agent.run(issue, mode=mode, target_start_utc=target_start)
    if result.status != "SUCCESS":
        code = "WEATHER_UNAVAILABLE" if result.error_code == "WEATHER_ERROR" else result.error_code
        return 503, {"status": "FAILED", "error_code": code, "message": result.error_message,
                     "events": result.events}
    artifact = json.loads(result.artifact_path.read_text(encoding="utf-8"))
    artifact["sites"] = [
        {"id": site_id, "name": f"Turbine {site_id}", "latitude": lat, "longitude": lon}
        for site_id, lat, lon in SITES
    ]
    artifact["metadata"]["power_unit"] = "normalized line-side active power"
    if mode == "historical":
        artifact["metadata"]["warnings"] = [
            "Weather run availability uses a seven-hour estimate; historical publication time is unverified."
        ]
    for turbine_id, summary in artifact["analysis"].items():
        if summary.get("large_change_hours", 0):
            artifact["metadata"].setdefault("warnings", []).append(
                f"Turbine {turbine_id} has {summary['large_change_hours']} large hourly power changes."
            )
    return 200, artifact


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if urlparse(self.path).path != "/api/ask":
            self._send(404, {"status": "FAILED", "error_code": "NOT_FOUND"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("request body must be 1–4096 bytes")
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError("request body must be an object")
        except (ValueError, UnicodeError) as error:
            self._send(400, {"status": "FAILED", "error_code": "INVALID_REQUEST", "message": str(error)})
            return
        try:
            output_dir = Path(os.getenv("WINDPOWER_OUTPUT_DIR", "artifacts/dashboard_runs"))
            document = load_forecast_run(output_dir, request.get("run_id"))
            answer = answer_forecast_question(document, request.get("question"), request.get("selected_lead_hour"),
                                              request.get("selected_turbine_id"), request.get("horizon"),
                                              regional_fetcher=lambda saved, context: fetch_regional_context(
                                                  saved, context, output_dir / "regional_context"))
        except ForecastQuestionError as error:
            self._send(error.status, {"status": "FAILED", "error_code": error.code, "message": str(error)})
            return
        self._send(200, {"status": "SUCCESS", "answer": answer,
                         "run_id": request["run_id"], "selected_lead_hour": request["selected_lead_hour"]})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/forecast":
            self._send(404, {"status": "FAILED", "error_code": "NOT_FOUND"})
            return
        params = parse_qs(parsed.query)
        mode = params.get("mode", ["live"])[0]
        raw_issue = params.get("issue", [None])[0]
        try:
            if mode == "live":
                issue = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
                raw_start = params.get("start", [None])[0]
                target_start = datetime.fromisoformat(raw_start.replace("Z", "+00:00")) if raw_start else None
            elif raw_issue:
                issue = datetime.fromisoformat(raw_issue.replace("Z", "+00:00"))
                target_start = None
            else:
                raise ValueError("historical mode requires an ISO UTC issue")
            if issue.tzinfo is None:
                raise ValueError("issue must include a timezone")
            if target_start is not None and target_start.tzinfo is None:
                raise ValueError("target start must include a timezone")
        except ValueError as error:
            self._send(400, {"status": "FAILED", "error_code": "INVALID_REQUEST", "message": str(error)})
            return
        status, document = forecast_document(
            mode, issue, Path(os.getenv("WINDPOWER_MODEL_PATH", "artifacts/model/model.joblib")),
            Path(os.getenv("WINDPOWER_CACHE_DIR", "artifacts/weather")),
            Path(os.getenv("WINDPOWER_OUTPUT_DIR", "artifacts/dashboard_runs")),
            target_start,
        )
        self._send(status, document)

    def _send(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    host = os.getenv("WINDPOWER_API_HOST", "127.0.0.1")
    port = int(os.getenv("WINDPOWER_API_PORT", "8000"))
    with ThreadingHTTPServer((host, port), Handler) as server:
        print(f"Windpower API serving on http://{host}:{port}")
        server.serve_forever()


if __name__ == "__main__":
    main()
