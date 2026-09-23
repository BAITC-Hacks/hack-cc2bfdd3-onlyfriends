# Сравнение девяти моделей ВЭС — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Провести ограниченный временной GridSearch по девяти семействам и выбрать модель без февральских фактов и утечки между выпусками.

**Architecture:** `search_estimators.py` задаёт совместимые sklearn-оценщики и фиксированные сетки. `model_search.py` строит внутренние временные folds, запускает `GridSearchCV`, затем переобучает лучшие конфигурации для внешних месяцев и сохраняет полные метрики. CLI вызывает этот сценарий на тех же SCADA и погодном кэше, что текущая модель. При устойчивом выигрыше отдельная задача связывает победителя с `model.py` и ретропрогнозом.

**Tech Stack:** Python 3.10, pandas, numpy, scikit-learn 1.7, CatBoost, pytest, uv. Новых зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-09-23-model-search-design.md`

## Global Constraints

- Внутренний поиск: июль–сентябрь 2025, только метки с `valid_time_utc < 2025-10-01 00:00 Asia/Almaty`.
- Внешняя оценка: выпуски октября 2025 — января 2026, тренировочные метки строго до первого выпуска месяца.
- Все кандидаты оцениваются на тех же строках и с `clip(prediction, 0, 1)`.
- Победа против `weather_d6_l10`: меньшая средняя MAE и выигрыш минимум в трёх из четырёх внешних месяцев; ранний выбор — два из трёх.
- Февральские значения мощности не участвуют ни в поиске, ни в выборе. Сохранённый февральский прогноз меняется только после подтверждённой победы и переобучения.

## Review Focus

1. Сентябрьский выпуск содержит целевой час в октябре: внутренняя проверка исключает эту строку из поиска до 1 октября.
2. Импутер/скейлер случайно обучен на внешнем месяце: тест проверяет, что они внутри `Pipeline` и каждого fold.
3. Небаланcные месяцы: выбор считает среднюю месячную MAE, а не среднюю по всем строкам.
4. Наивный эталон видит фактическую февральскую мощность: тест ограничивает окно прошлого на `fit` и сохраняет прежнее значение при `predict`.
5. Погодная модель выдаёт <0 или >1: подбор и внешние метрики обрезают прогноз одинаково.

---

### Task 1: Схема данных, наивные модели и временные folds

**Files:** `windpower/search_estimators.py`, `windpower/model_search.py`, `tests/test_model_search.py`.

**Interfaces:** `SeasonalMeanRegressor.fit/predict`, `IsotonicWindRegressor.fit/predict`, `inner_cv_indices(examples) -> list[(train_idx, valid_idx)]`.

- [ ] Написать тесты, где июньские строки доступны в train июля, целевой час сентябрьского выпуска после 1 октября исключён из поиска, а наивная модель не меняет прогноз при изменении будущего `X`.
- [ ] Запустить `uv run pytest -q tests/test_model_search.py`; убедиться в ожидаемых отказах.
- [ ] Реализовать sklearn-совместимые наивную модель с окнами 30/90/365 дней и изотоническую кривую для ветра 10/100 м. Преобразовать issue-folds из `rolling_folds` в позиционные индексы массива, предварительно ограниченного `valid_time < 2025-10-01`.
- [ ] Запустить тесты и сделать коммит.

### Task 2: Девять семейств и GridSearchCV

**Files:** `windpower/search_estimators.py`, `windpower/model_search.py`, `tests/test_model_search.py`.

**Interfaces:** `candidate_grids() -> dict[str, (estimator, grid)]`, `search_one(name, estimator, grid, X, y, folds) -> result`.

- [ ] Добавить тест, который перечисляет все девять имён, клонирует каждый estimator, проверяет непустую ограниченную сетку и эквивалентность clipped MAE при прогнозе вне `[0,1]`.
- [ ] Проверить красный тест. Реализовать `Pipeline` с импутацией внутри folds для Ridge, ElasticNet, RF, ET, HGB и MLP; для линейных моделей добавить `SplineTransformer` только к скорости ветра. CatBoost получает DataFrame с `turbine_id` как категорией. Использовать `GridSearchCV(cv=inner_cv_indices(...), refit=False, n_jobs=1, scoring=clipped_neg_mae)`; фиксировать seed 42 и ресурсные границы.
- [ ] Сохранить `cv_results_` для каждой конфигурации, параметры лучшей по средней внутренней MAE. Запустить тесты и сделать коммит.

### Task 3: Внешняя проверка и сравнение турбин

**Files:** `windpower/model_search.py`, `scripts/run_model_search.py`, `tests/test_model_search.py`, `artifacts/model_search/*`, `docs/EVALS.md`.

**Interfaces:** `run_search(raw_dir, artifacts_dir) -> search summary`; CLI `uv run python scripts/run_model_search.py`.

- [ ] Тестом зафиксировать, что для каждого внешнего месяца параметры уже выбраны на июле–сентябре, обучение получает только прошлые метки, сравнение включает оба горизонта и обе турбины, а кандидат не заменяет incumbent после одного удачного месяца.
- [ ] Реализовать запуск девяти семейств на одинаковых внешних folds; записать `inner_grid.csv`, `outer_monthly.csv`, `outer_by_turbine.csv`, `outer_by_issue_day.csv`, `best_params.json`, `selection.json` и парные разности относительно действующей модели. Сравнение отдельных турбин сохранить отдельной контрольной строкой, не подмешивая её в GridSearch.
- [ ] Выполнить реальный поиск на `raw/` и `artifacts/weather/`, сверить воспроизведение действующей MAE 0,153514 и оценить месячную устойчивость. Записать победителя по заранее заданному правилу. Сделать коммит отчёта и кода.

### Task 4: Рабочая модель и проверка

**Files:** `windpower/model.py`, `windpower/training.py`, `windpower/workflow.py`, `scripts/verify_outputs.py`, `README.md`, `docs/EVALS.md`, `artifacts/model/*`, `artifacts/backtest_*.csv`.

- [ ] Если ни один новый кандидат не проходит правило Task 3, сохранить действующие версии и прогнозы; отразить отрицательный результат и лучшие параметры всех семейств в README.
- [ ] Если новый кандидат проходит правило, добавить только его конфигурацию в версионированный `model.py`, тест совместимости bundle и ранней версии, повысить версию алгоритма, обучить две отсечки и заново выпустить 29 прогнозов.
- [ ] В любом случае запустить `uv run --group dev pytest -q`, `uv run python scripts/verify_outputs.py`, `git diff --check`; проверить, что JSON/CSV содержат фактические числа и не называют месяцы подбора независимым февральским тестом.
