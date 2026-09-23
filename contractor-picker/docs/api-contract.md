# Контракт API, версия 1

Все ответы JSON, кроме страницы и статических ресурсов. API и страница имеют один origin.

## GET /api/meta

Возвращает `total`, `cities`, `categories`, `event_formats`, `languages`, `calendar: {from,to}`, `synthetic_count`, `dataset_version`. Справочники строятся из CSV. Интерфейс не ограничивает список категорий выбранным городом: отсутствие категории является отдельным проверяемым исходом.

## GET /api/catalog

Возвращает `total`, `dataset_version` и публичные поля всех объявлений в `items`: ID, анонимное имя, категории, город, начальная цена, форматы событий, языки, максимальная длительность, описание и флаги качества данных. Даты занятости в ответ каталога не включены — они используются только при проверке подбора.

## POST /api/recommend

Обязательный заголовок `Content-Type: application/json`.

| Поле | Тип | Ограничение |
|---|---|---|
| city | string | Значение из справочника |
| date | string | Реальная дата YYYY-MM-DD в календарном окне |
| event_format | string | Значение из справочника |
| category | string | Значение из справочника |
| budget | number | Целое число 1–1 000 000 000 |
| language | string/null | Необязательно, значение из справочника |
| duration_hours | number/null | Необязательно, больше 0 и не больше 24 |
| locale | string | Необязательно: `ru`, `kk` или `en`; язык ответа и объяснения |
| current_keywords | string[] | Необязательно: до 12 предпочтений из сообщения ассистенту; учитываются после обязательных фильтров и используются для AI-ранжирования всех прошедших кандидатов |

Пустая строка, null или отсутствие необязательного поля означает «не ограничивать». Строки вместо чисел отклоняются. Город, категория и формат очищаются от пробелов по краям. Неизвестные поля не используются.

Пример запроса:

```json
{
  "city": "Алматы",
  "date": "2026-10-10",
  "event_format": "корпоратив",
  "category": "Ведущий",
  "budget": 1500000,
  "language": null,
  "duration_hours": null
}
```

Успешный HTTP-ответ 200 содержит:

- `status`: matched / category_absent / no_matches.
- `cards`: 0–3 карточки с id, name, category, categories, city, price_from_kzt, languages, max_hours, synthetic, city_imputed, price_imputed, explanation, evidence.
- `evidence`: id фрагмента, его точный text, truncated и source=description.
- `counts`: in_category, eligible, shown, excluded (busy, budget, format, language, duration).
- `busy_contractors`: ID и имена занятых в выбранных городе и категории, для объяснения исключения; не рекомендации.
- `minimum_price`: минимальная начальная цена в городе/категории до других фильтров; null при отсутствии категории. Это справочная цена, не обещание доступности на дату.
- `ranking`: `price_asc_then_id` без предпочтений или `keyword_relevance`, если заданы ключевые слова.
- `preference_keywords`: предпочтения, по которым ранжированы объявления.
- `query`: нормализованные параметры.
- `dataset_version`: первые 12 символов SHA-256 исходного CSV.
- `explanation_mode`: ai / catalog / fast_local / keyword_fallback / fallback / not_needed. `ai` means a second model pass semantically ranked eligible listings against extracted preferences; `fast_local` is reserved for explicitly local-only callers.
- `elapsed_ms`: время обработки на сервере.

`catalog` означает отсутствие настроенного ключа. `fallback` — AI был настроен, но не дал пригодного ответа. `ai` ставится только после успешной проверки всех фрагментов. `not_needed` — карточек нет.

При одинаковом запросе и CSV порядок ID неизменен. `elapsed_ms` может различаться. Текст выбранного AI-фрагмента стабилен внутри кеша, но может измениться после перезапуска; требование детерминизма относится к порядку карточек.

## Ошибки

- HTTP 400: invalid_input с message и fields (словарь имя поля → пояснение), либо invalid_json.
- HTTP 413: too_large.
- HTTP 404: not_found для неизвестного API-адреса.
- HTTP 500: server_error без внутренних подробностей.

Отсутствие результатов — HTTP 200, не ошибка. Ошибка AI не меняет кандидатов и HTTP-статус подбора.

## GET /api/health

Возвращает status=ok, profiles, dataset_version и assistant_configured. Последнее поле сообщает только наличие серверной настройки ключа, не проверяет доступность OpenAI и не раскрывает секрет.

## POST /api/assistant

Принимает сообщение длиной 1–1000 символов, текущий черновик формы и версию состояния:

```json
{
  "message": "А на 11 октября?",
  "locale": "ru",
  "current_keywords": ["живой звук", "лёгкий юмор"],
  "current_query": {
    "city": "Алматы",
    "date": "2026-10-10",
    "event_format": "корпоратив",
    "category": "Ведущий",
    "budget": 1500000,
    "language": null,
    "duration_hours": null
  },
  "state_revision": 3
}
```

Модель возвращает серверу intent, предпочтения в `keywords` и список операций set/clear. Сервер заново проверяет обязательные условия и выбирает только прошедшие их объявления, затем семантически ранжирует весь список кандидатов по предпочтениям (включая синонимы и детали запроса). Ответ содержит `assistant_status`, `reply`, `resolved_query`, `criteria` (`conditions` и `preferences`), `keywords`, `missing_fields`, `updated_fields`, `recommendation`, `suggestions` и исходный `state_revision`.

- `needs_clarification`: обязательных данных не хватает или изменение неоднозначно;
- `results`: выполнен обычный проверяемый подбор;
- `explained`: показано сравнение или справка;
- HTTP 503 `assistant_unavailable`: модель недоступна; ручная форма продолжает работать.

`suggestions` формируются кодом, а не моделью. Для альтернативной даты и бюджета полный подбор выполняется повторно. Предложения не применяются автоматически.
