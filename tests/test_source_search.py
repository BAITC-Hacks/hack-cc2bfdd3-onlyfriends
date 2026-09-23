import pytest

from windpower import source_search


class FakeDDGS:
    calls = []

    def __init__(self, timeout):
        self.calls.append(("timeout", timeout))

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def text(self, query, max_results, safesearch):
        self.calls.append((query, max_results, safesearch))
        return [
            {"title": "Open-Meteo", "href": "https://open-meteo.com/docs", "body": "archive"},
            {"title": "Unsafe", "href": "http://example.com", "body": "ignored"},
            {"title": "Malformed", "href": "https://[bad", "body": "ignored"},
        ]


def test_search_returns_bounded_cited_snippets_not_historical_evidence(monkeypatch):
    FakeDDGS.calls = []
    monkeypatch.setattr(source_search, "DDGS", FakeDDGS)

    result = source_search.search_web(" Open-Meteo   Single Runs ")

    assert FakeDDGS.calls == [
        ("timeout", source_search.SEARCH_TIMEOUT_SECONDS),
        ("Open-Meteo Single Runs", source_search.MAX_RESULTS, "moderate"),
    ]
    assert result["historical_availability_verified"] is False
    assert result["results"] == [{
        "title": "Open-Meteo", "url": "https://open-meteo.com/docs", "snippet": "archive",
    }]
    assert result["retrieved_at_utc"].endswith("+00:00")


@pytest.mark.parametrize("query", ["", "   ", "x" * 201, None])
def test_search_rejects_invalid_queries(query):
    with pytest.raises(ValueError, match="search query"):
        source_search.normalize_query(query)


def test_search_provider_failure_is_explicit(monkeypatch):
    class FailingDDGS(FakeDDGS):
        def text(self, query, max_results, safesearch):
            raise TimeoutError("search timed out")

    monkeypatch.setattr(source_search, "DDGS", FailingDDGS)

    with pytest.raises(TimeoutError, match="search timed out"):
        source_search.search_web("weather source documentation")
