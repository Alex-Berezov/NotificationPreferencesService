# Notification Preferences Service

Небольшой сервис, который отвечает на один вопрос: «можно ли сейчас послать этому пользователю это уведомление по этому каналу?» — с учётом дефолтов, его собственных настроек, окна тишины и глобальных policy.

Стек: TypeScript · Node 22 · Fastify 5 · Prisma 6 · PostgreSQL 16 · Zod · Luxon · Vitest.

---

## Запуск

**Через Docker Compose** (самый быстрый путь — поднимается Postgres, накатываются миграции и seed):

```bash
docker compose up --build
curl http://localhost:3000/healthz   # {"status":"ok"}
```

**Локально:**

```bash
cp .env.example .env
npm ci
npx prisma migrate dev               # миграции + seed
npm run dev
```

Полезные скрипты: `npm test` (unit, ~0.4s, без БД), `npm run test:int` (integration через Testcontainers — нужен Docker), `npm run lint`, `npm run typecheck`, `npm run build`.

---

## API

Базовый URL `http://localhost:3000`. JSON везде. Ошибки в едином конверте `{ "error": { "code", "message", "details?" } }`. Заголовок `x-request-id` принимается на входе или генерируется UUID, возвращается в ответе и попадает во все логи.

### `GET /users/:id/preferences`

Эффективные настройки: defaults, поверх которых наложены overrides, плюс quiet hours. Каждая запись имеет `source: "default" | "override"`. `quietHours` может быть `null`.

### `POST /users/:id/preferences`

Частичное обновление. Минимум одно из полей:

```json
{
  "toggles": [{ "type": "marketing_email", "channel": "email", "enabled": false }],
  "quietHours": { "start": "22:00", "end": "08:00", "timezone": "Europe/Berlin" }
}
```

- `toggles` — батч-upsert, идемпотентно;
- `quietHours: null` — **очистить** окно тишины;
- поле отсутствует — не трогаем (`absent ≠ null`).

### `POST /evaluate`

```json
{
  "userId": "alice",
  "notificationType": "marketing_push",
  "channel": "push",
  "region": "EU",
  "datetime": "2026-06-15T21:30:00Z"
}
```

Ответ: `{ "decision": "allow" | "deny", "reason": "allowed" | "blocked_by_global_policy" | "disabled_by_user" | "disabled_by_default" | "quiet_hours" }`.

### `GET /healthz`

Liveness-probe → `{ "status": "ok" }`.

---

## Как принимается решение

Чистая функция [`evaluate`](src/domain/evaluator.ts), приоритет **deny-wins**:

1. Подходящая **global policy** (с учётом wildcard `channel: null`) → `blocked_by_global_policy`.
2. Эффективная запись = `override ?? default`. Если её нет → `disabled_by_default`.
3. Запись `enabled: false` → `disabled_by_user` (или `disabled_by_default`, если источник — дефолт).
4. **Quiet hours** — только для `marketing_*` (transactional не глушим). Если `datetime` попадает в окно → `quiet_hours`.
5. Иначе → `allowed`.

Окно тишины хранится как `(startMinutes, endMinutes, timezone)`, а не как UTC-интервал — иначе оно дважды в год «протухало бы» из-за DST. Проверка делается через Luxon: переводим UTC-instant в локальное время указанной зоны и сравниваем минуты с полуночи. Корректно работает с переходом через полночь (`[22:00, 08:00)`) и обоими видами DST-сдвигов.

---

## Архитектура и почему так

**Hexagonal lite (Ports & Adapters)** без DI-фреймворка. Четыре слоя:

```
domain/         ← чистые типы и правила. Ноль зависимостей от Prisma/Fastify.
application/    ← use-cases + порты (PreferencesRepository, DefaultsRepository, ...).
infrastructure/ ← Prisma-репозитории, pino, config. Реализации портов.
http/           ← Fastify-роуты, Zod-схемы, errorMapper. Тонкий слой.
```

`src/index.ts` — единственное место «композиционного клея»: грузим config → pino → Prisma → 3 репозитория → `buildServer({ repos, ... })` → `listen`.

### Почему такой выбор

- **Fastify** вместо Express/Nest — он быстрее, есть встроенный pino с per-request `reqId`, и нет тонны boilerplate. Для трёх роутов NestJS — оверкилл.
- **Prisma** — быстро даёт типизированную модель и нормальные миграции. Зафиксирована на `6.16.x` LTS; v7 ломает совместимость (выносит `datasource.url` в `prisma.config.ts`, требует driver-adapter), бизнес-выгоды для этого сервиса нет.
- **Hexagonal lite** — главная угроза для качества тут не CRUD, а *бизнес-правила* (приоритеты, DST, deny-wins). Чистый домен без БД покрывается unit-тестами за миллисекунды; через MVC те же правила тестировались бы через Postgres.
- **Без DI-контейнера** — граф плоский (3 репозитория + логгер). Ручная композиция в `index.ts` короче и прозрачнее декораторов/метаданных.
- **Zod на границе HTTP**, доменные `parse*` — на границе домена. HTTP не пускает мусор внутрь; домен сам валидирует ещё раз через branded-типы (`UserId`, `Region`).

### Модель данных (`prisma/schema.prisma`)

- `DefaultPreference (notificationType, channel) → enabled` — 8 строк, накатывается seed-ом.
- `UserPreferenceOverride (userId, notificationType, channel) → enabled` — индекс по `userId`.
- `UserQuietHours (userId) → (startMinutes, endMinutes, timezone)` — одна строка на пользователя.
- `GlobalPolicy (notificationType, region, channel?)` — `channel = null` это wildcard.

Дефолты **не дублируются** в overrides — `getPreferences` материализует merge на лету. Это экономит место и не даёт overrides «застрять» в устаревшем значении, если дефолт поменяется.

---

## Тесты

- **Unit (`npm test`)** — 27 тестов в `tests/unit/`, ~0.4 s, без БД: evaluator (все 5 веток приоритета + edge-cases), quietHours (границы, wrap-around, DST spring/fall, half-open), merge defaults+overrides.
- **Integration (`npm run test:int`)** — 13 тестов через Testcontainers + реальный Postgres. Поднимается контейнер, накатываются миграции и seed, запросы идут через `app.inject(...)` (без сети). Покрывает все 3 эндпоинта, идемпотентность, decision-matrix `/evaluate` и валидации.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) — 4 параллельные job-ы: lint+typecheck, unit, integration, docker-build.

---

## Логи и метрики

Pino через Fastify. В dev — `pino-pretty`, в prod — JSON. Каждый запрос получает `reqId`, который наследуют все логи use-case'ов. Два аудит-события на доменном уровне:

- `notification.evaluated` — вход + `decision` + `reason`.
- `preferences.changed` — `toggleDiff` и `quietHoursDiff` (пустой diff виден явно).

Метрики Prometheus не подключал, но в use-case'ах оставил маркеры `// METRIC: counter ...{labels}` — подключение `@fastify/metrics` под них точечное и не требует архитектурных изменений.

---

## Что осознанно НЕ сделано

- **Аутентификация/авторизация** — сервис внутренний, скоуп ТЗ.
- **Rate limiting** — добавляется `@fastify/rate-limit` одной регистрацией.
- **Кэш** — `/evaluate` делает 3 параллельных query (`Promise.all`); под нагрузкой докидывается Redis с инвалидацией на `preferences.changed`. Архитектура к этому готова.
- **OpenTelemetry** — оставлены маркеры метрик, полный OTel — отдельная задача, зависит от инфры заказчика.

### Известная мелочь

VS Code-расширение Prisma последних версий валидирует схему по правилам Prisma 7 и подсвечивает строку `url = env("DATABASE_URL")` как ошибку. Для нашей версии (Prisma 6) эта строка обязательна — это false positive расширения. CLI `prisma validate` / `prisma generate` проходят без замечаний.
