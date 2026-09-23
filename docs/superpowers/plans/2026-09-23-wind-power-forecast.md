# Wind Power Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Обучить и проверить модель 48-часового прогноза мощности двух турбин на архивных погодных прогнозах, затем выпустить последовательные прогнозы за февраль 2026 года.

**Architecture:** `windpower.data` переводит 10-минутный SCADA в почасовые цели. `windpower.weather` получает конкретные выпуски ECMWF и кэширует ответы. `windpower.model` строит признаки, модели и временную проверку. `windpower.cli` собирает автономный цикл с журналом и артефактами.

**Tech Stack:** Python 3.10+, pandas, numpy, CatBoost, scikit-learn, joblib, requests, pytest, uv.

**Spec:** `docs/superpowers/specs/2026-09-23-wind-power-forecast-design.md`

## Global Constraints

- Ввод: два CSV в `raw/`, 10-минутные метки без часового пояса; по умолчанию `Asia/Almaty`.
- Часовая цель: средняя мощность при минимум четырёх корректных 10-минутных записях.
- Обучение и выбор модели: для первого выпуска цель строго раньше 2026-01-31 00:00, отбор кандидата по октябрю — декабрю 2025; для остальных выпусков цель строго раньше 2026-02-01 00:00.
- Выпуск: ежедневно 00:00 локального времени, горизонты 1–48 часов.
- Погода: только Open-Meteo Single Runs API, модель `ecmwf_ifs`, цикл не позже 7 часов до выпуска.
- Результат: прогнозы по каждой турбине и сумма станции, метрики по месяцам и горизонтам, журнал, две неизменяемые версии модели.
- Сырые данные и большие кэши не коммитить; `raw/`, `artifacts/`, `.venv/` в `.gitignore`.

## Review Focus

1. Время с однозначным часом (`0:00:00`) читается без потери ночных наблюдений — тест Task 1.
2. Погодный цикл не был выбран слишком поздним для момента выпуска — тест Task 2.
3. Месячная проверка не видит будущую цель через пересекающиеся 48-часовые выпуски — тест Task 4.
4. Пропуск погодного часа прерывает выпуск вместо сдвига предсказаний — тест Task 2.
5. Повторное исполнение не перезаписывает ранее выпущенный прогноз при новой погоде — тест Task 5.
6. Модель и её подбор для 31 января не видят метки, появившиеся после выпуска; любой прогноз отвергает модель с будущими обучающими метками.

---

### Task 1: Загрузка и почасовая агрегация SCADA

**Files:** `pyproject.toml`, `.gitignore`, `windpower/__init__.py`, `windpower/data.py`, `tests/test_data.py`.

**Interfaces:**
- Produces: `load_history(paths: dict[str, Path], timezone: str = "Asia/Almaty") -> pandas.DataFrame` с `valid_time_utc`, `turbine_id`, `power`, `measured_wind`, `measured_temp`, `sample_count`.

- [ ] Написать тесты `test_parses_single_digit_hours_and_aggregates_six_samples`, `test_rejects_duplicate_timestamp`, `test_drops_hours_with_fewer_than_four_valid_samples` с временными CSV и явными числовыми ожиданиями; создать `pyproject.toml` и `.gitignore`.
- [ ] Выполнить `uv run pytest tests/test_data.py -q`; ожидается FAIL из-за отсутствия `load_history`.
- [ ] Реализовать чтение точных русских заголовков, `pd.to_datetime(..., format="mixed")` или `strptime` fallback, локализацию времени, валидацию и `resample("h")` по турбине. Отчёт об исключённых строках вернуть в `DataFrame.attrs["quality"]`.
- [ ] Выполнить `uv run pytest tests/test_data.py -q`; ожидается PASS 3/3.
- [ ] Коммит `feat: parse and aggregate turbine history`.

### Task 2: Архив реальных погодных выпусков

**Files:** `windpower/weather.py`, `tests/test_weather.py`.

**Interfaces:**
- Produces: `select_run(issue_utc: datetime, delay_hours: int = 7) -> datetime`.
- Produces: `fetch_issue(issue_utc: datetime, cache_dir: Path, session: requests.Session | None = None) -> pandas.DataFrame` с `issue_time_utc`, `run_time_utc`, `valid_time_utc`, `turbine_id`, `lead_hour`, погодными колонками.

- [ ] Написать `test_select_run_prior_to_publication`, `test_exact_48_hour_alignment`, `test_missing_hour_raises` с локальным JSON-ответом или подставленным `Session`, без сетевого запроса.
- [ ] Выполнить `uv run pytest tests/test_weather.py -q`; ожидается FAIL из-за отсутствия экспортов.
- [ ] Реализовать `select_run`, запрос обеих координат одним вызовом API, валидацию UTC/единиц/48 часов, SHA-256 и атомарный кэш по cycle+issue. Повторять HTTP 429/5xx с ограниченным backoff.
- [ ] Выполнить `uv run pytest tests/test_weather.py -q`; ожидается PASS 3/3. Вручную запросить один январский выпуск и сохранить проверенный ответ в локальном кэше.
- [ ] Коммит `feat: fetch archived weather runs safely`.

### Task 3: Формирование обучающих примеров

**Files:** `windpower/features.py`, `tests/test_features.py`.

**Interfaces:**
- Consumes: `load_history`, `fetch_issue`.
- Produces: `make_features(weather: pandas.DataFrame) -> pandas.DataFrame`.
- Produces: `build_examples(history: pandas.DataFrame, weather: pandas.DataFrame, cutoff_local: str = "2026-02-01", timezone: str = "Asia/Almaty") -> pandas.DataFrame`.

- [ ] Написать `test_no_february_target_joins`, `test_features_use_only_forecast_columns`, `test_join_preserves_turbine_and_hour`.
- [ ] Выполнить `uv run pytest tests/test_features.py -q`; ожидается FAIL из-за отсутствия экспортов.
- [ ] Реализовать календарные sin/cos, sin/cos направления ветра, отношение ветра 100/10 м, слияние по `valid_time_utc`+`turbine_id`; drop без цели и строгую отсечку до февраля.
- [ ] Выполнить `uv run pytest tests/test_features.py -q`; ожидается PASS 3/3.
- [ ] Коммит `feat: build leakage-safe forecast examples`.

### Task 4: Временная проверка и обучение

**Files:** `windpower/model.py`, `tests/test_model.py`.

**Interfaces:**
- Consumes: `build_examples` и `make_features`.
- Produces: `rolling_folds(examples: pandas.DataFrame, months: list[str]) -> iterator[tuple[DataFrame, DataFrame]]`.
- Produces: `select_and_train(examples: pandas.DataFrame, history: pandas.DataFrame, output_dir: Path) -> dict`.
- Produces: `predict(bundle: dict, weather: pandas.DataFrame) -> pandas.DataFrame`.

- [ ] Написать `test_folds_never_train_on_validation_or_february`, `test_predictions_clipped_and_ordered`, `test_selection_uses_average_mae_not_best_single_month`; данные теста синтетические и малы.
- [ ] Выполнить `uv run pytest tests/test_model.py -q`; ожидается FAIL из-за отсутствия экспортов.
- [ ] Реализовать базовую бинированную кривую, прямой CatBoost и двухэтапный кандидат. Проверять октябрь 2025 — январь 2026 в rolling folds; сетка CatBoost: depth 4/6, l2_leaf_reg 3/10, iterations 500, learning_rate 0.04, fixed seed. Основной критерий — средний MAE по месяцам, tie-break — худший месячный MAE и RMSE. Печатать метрики обеих горизонтов, сохранять CSV и bundle через joblib. Прямую и двухэтапную модели refit только на доступных данных. Если двухэтапная модель не выдерживает устойчивый выигрыш, выбрать прямую.
- [ ] Выполнить `uv run pytest tests/test_model.py -q`; ожидается PASS 3/3. Затем `uv run pytest -q`; ожидается весь набор PASS.
- [ ] Коммит `feat: select wind-power model with rolling validation`.

### Task 5: Автономный цикл, прогнозы и README

**Files:** `windpower/cli.py`, `windpower/__main__.py`, `tests/test_cli.py`, `README.md`.

**Interfaces:**
- Consumes: `load_history`, `fetch_issue`, `build_examples`, `select_and_train`, `predict`.
- Produces: `python -m windpower train`, `python -m windpower forecast --issue 2026-01-31`, `python -m windpower backtest --from 2026-01-31 --to 2026-02-28`, `python -m windpower run`.

- [ ] Написать `test_backtest_writes_29_issues_and_48_hours_each`, `test_repeated_issue_is_idempotent`, `test_new_weather_run_keeps_old_forecast` с локальным кэшем и малым bundle.
- [ ] Выполнить `uv run pytest tests/test_cli.py -q`; ожидается FAIL из-за отсутствия CLI.
- [ ] Реализовать CLI и agent loop: проверка входа, fetch, подготовка, обучение по изменившемуся хешу данных, forecast, анализ диапазона/пропусков, журнал JSON; при новой версии погоды отдельный файл прогноза. README описывает команды и честные ограничения метрик.
- [ ] Выполнить `uv run pytest -q`; ожидается PASS. Запустить полный pipeline на реальном SCADA: архив погоды, rolling CV, refit и 29 выпусков. Проверить число строк, отсутствие тренировочных меток февраля, файл метрик и даты источника погоды.
- [ ] Коммит `feat: run reproducible historical forecast workflow`.

## Финальная проверка

- `uv run pytest -q` — все тесты проходят.
- `uv run python -m windpower train` — модель и честные метрики создаются из `raw/`.
- `uv run python -m windpower backtest --from 2026-01-31 --to 2026-02-28` — 29 выпусков по 48 часов на турбину.
- Проверить `git status`, `git diff --check`, артефакты и журнал; не заявлять метрики февраля без февральских фактических значений.
