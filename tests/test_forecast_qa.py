"""Forecast questions must use only the selected saved run and valid date."""

from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
import json
from threading import Thread
from urllib.request import Request, urlopen

import pytest

from windpower.forecast_qa import (
    ForecastQuestionError, answer_forecast_question, build_question_context, load_forecast_run,
)


def forecast_document():
    issue = datetime(2026, 2, 22, 19, tzinfo=timezone.utc)
    weather, forecast = [], []
    for lead in range(1, 49):
        valid = (issue + timedelta(hours=lead)).isoformat()
        for turbine in ("1", "2"):
            weather.append({
                "turbine_id": turbine, "lead_hour": lead, "valid_time_utc": valid,
                "wind_speed_10m": 5.0, "wind_speed_100m": 10.0 + lead / 10,
                "wind_direction_100m": 180.0, "temperature_2m": 2.0,
                "surface_pressure": 1000.0,
            })
            forecast.append({"turbine_id": turbine, "lead_hour": lead,
                             "valid_time_utc": valid, "predicted_power": 0.4})
    return {"metadata": {"run_id": "a" * 20, "issue_time_utc": issue.isoformat(),
                         "weather_source": "Open-Meteo Single Runs API", "run_time_utc": issue.isoformat()},
            "weather": weather, "forecast": forecast}


class RecordingModel:
    def __init__(self, answer):
        self.answer = answer
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        return type("Reply", (), {"content": self.answer})()


def test_russian_question_uses_selected_february_23_forecast():
    document = forecast_document()
    context = build_question_context(document, 4, "2", 24)
    assert context["issue_time_local"] == "2026-02-23T00:00+05:00"
    assert context["selected_date_local"] == "2026-02-23"
    assert context["selected_valid_time_local"] == "2026-02-23T04:00+05:00"
    assert len(context["rows"]) == 24
    assert {row["turbine_id"] for row in context["rows"]} == {"2"}
    model = RecordingModel("На 23 февраля прогнозируется ветер 10–12 м/с; причина неизвестна.")
    answer = answer_forecast_question(document, "почему за этот день такой сильный ветер", 4, "2", 24, model)
    assert "23 февраля" in answer
    assert "selected_date_local\": \"2026-02-23" in model.messages[1].content
    assert "ONE or TWO short sentences" in model.messages[0].content


def test_question_rejects_bad_selection_and_missing_run(tmp_path):
    document = forecast_document()
    with pytest.raises(ForecastQuestionError, match="Invalid selected hour"):
        build_question_context(document, 25, None, 24)
    with pytest.raises(ForecastQuestionError, match="Invalid forecast run ID"):
        load_forecast_run(tmp_path, "../secret")
    with pytest.raises(ForecastQuestionError, match="no longer available"):
        load_forecast_run(tmp_path, "a" * 20)
    (tmp_path / ("a" * 20 + ".json")).write_text(json.dumps(document), encoding="utf-8")
    assert load_forecast_run(tmp_path, "a" * 20)["metadata"]["run_id"] == "a" * 20


def test_question_fails_explicitly_when_model_fails():
    class FailedModel:
        def invoke(self, messages):
            raise TimeoutError("provider timeout")

    with pytest.raises(ForecastQuestionError) as error:
        answer_forecast_question(forecast_document(), "Почему ветер сильный?", 1, None, 48, FailedModel())
    assert error.value.code == "ASSISTANT_UNAVAILABLE"
    assert "provider timeout" not in str(error.value)


def test_live_regional_evidence_is_explicitly_marked_as_separate():
    regional = {"status": "available", "same_run_verified": False,
                "retrieved_at_utc": "2026-09-23T10:00:00+00:00"}
    result = answer_forecast_question(
        forecast_document(), "почему ветер сильный?", 1, None, 48,
        model=RecordingModel("Градиент давления согласуется с усилением ветра."),
        regional_fetcher=lambda document, context: regional,
    )
    assert "Региональные данные получены отдельно" in result
    assert "выпуск может отличаться" in result


def test_peak_power_question_is_exact_and_skips_model_and_regional_fetch():
    document = forecast_document()
    for row in document["forecast"]:
        if row["lead_hour"] == 23:
            row["predicted_power"] = 0.9 if row["turbine_id"] == "1" else 0.7

    class ForbiddenModel:
        def invoke(self, messages):
            raise AssertionError("peak power must be calculated, not invented")

    answer = answer_forecast_question(
        document, "в какой день будет самый большой Normalized power", 1, None, 48,
        model=ForbiddenModel(),
        regional_fetcher=lambda saved, context: (_ for _ in ()).throw(AssertionError("weather called")),
    )
    assert answer == "По прогнозу пик почасовой нормализованной мощности — 23.02.2026 в 23:00 (UTC+5): 0,800 (среднее двух турбин)."


def test_http_ask_reads_selected_saved_run(tmp_path, monkeypatch):
    from windpower import api

    document = forecast_document()
    (tmp_path / ("a" * 20 + ".json")).write_text(json.dumps(document), encoding="utf-8")
    monkeypatch.setenv("WINDPOWER_OUTPUT_DIR", str(tmp_path))
    seen = {}

    def fake_answer(saved, question, lead, turbine, horizon, regional_fetcher=None):
        seen.update(context=build_question_context(saved, lead, turbine, horizon), question=question)
        return "23 февраля прогнозируется сильный ветер."

    monkeypatch.setattr(api, "answer_forecast_question", fake_answer)
    server = ThreadingHTTPServer(("127.0.0.1", 0), api.Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        body = json.dumps({"run_id": "a" * 20, "question": "почему за этот день сильный ветер",
                           "selected_lead_hour": 4, "selected_turbine_id": "2", "horizon": 24}).encode()
        request = Request(f"http://127.0.0.1:{server.server_port}/api/ask", data=body,
                          headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=5) as response:
            result = json.load(response)
        assert result["status"] == "SUCCESS"
        assert result["selected_lead_hour"] == 4
        assert seen["context"]["selected_date_local"] == "2026-02-23"
        assert seen["context"]["selected_turbine_id"] == "2"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
