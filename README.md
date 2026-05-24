# Notification Preferences Service

Сервис управления **пользовательскими настройками уведомлений** — единый источник правды для решения «отправлять ли это уведомление этому пользователю по этому каналу прямо сейчас».

> TypeScript 6 · Node.js 20 · Fastify 5 · Prisma 6 · PostgreSQL 16 · Zod 4 · Luxon 3 · Vitest 4

---

## Содержание

1. [Что делает сервис](#что-делает-сервис)
2. [Быстрый старт](#быстрый-старт)
3. [HTTP API](#http-api)
4. [Архитектура](#архитектура) ← обоснование выбора
5. [Модель данных](#модель-данных)
6. [Правила принятия решения](#правила-принятия-решения)
7. [Тестирование](#тестирование)
8. [Observability и метрики](#observability-и-метрики)
9. [Project layout](#project-layout)
10. [Решения и trade-offs](#решения-и-trade-offs)

---

## Что делает сервис

- Хранит **defaults** — системные правила «по умолчанию» для каждой пары `(notificationType, channel)`.
- Хранит **user overrides** — пользовательские переопределения.
- Хранит **quiet hours** — окно тишины пользователя с учётом IANA-таймзоны.
- Хранит **global policies** — региональные/комплаенс-запреты (GDPR, отрасль и т.п.).
- Отвечает на вопрос `POST /evaluate` — **allow** или **deny** с указанием причины, детерминированно за один HTTP-запрос.

---

## Быстрый старт

### Docker Compose (рекомендованный путь)

```bash
docker compose up --build
# Postgres + сервис поднимаются с миграциями и сидом
curl http://localhost:3000/healthz
# {"status":"ok"}
```

### Локальная разработка

```bash
cp .env.example .env                      # настроить DATABASE_URL
npm ci
npx prisma generate
npx prisma migrate dev                    # применит миграции и накатит seed
npm run dev                               # tsx watch
```

### Скрипты npm

| Скрипт | Назначение |
|---|---|
| `npm run dev` | tsx watch с hot-reload |
| `npm run build` | TypeScript → `dist/` |
| `npm start` | Запуск собранного `dist/src/index.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (strict-type-checked) + Prettier check |
| `npm run format` | Авто-фикс |
| `npm test` | Unit-тесты (Vitest) |
| `npm run test:int` | Integration-тесты (Testcontainers + Postgres) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Применение `prisma/seed.ts` |

---

## HTTP API

Базовый URL: `http://localhost:3000`. Все запросы и ответы — JSON. Все ошибки — стабильный envelope:

```json
{ "error": { "code": "validation_error", "message": "...", "details": [...] } }
```

Заголовок `x-request-id` пробрасывается на вход (любой ID) или генерируется UUID — и возвращается в ответе и попадает во все логи как `reqId`.

### `GET /healthz`

Liveness-probe. `200 OK` → `{ "status": "ok" }`.

### `GET /users/:id/preferences`

Возвращает **эффективные** настройки пользователя: defaults, поверх которых наложены overrides, плюс quiet hours.

**Response 200:**
```json
{
  "userId": "alice",
  "entries": [
    { "type": "transactional_email", "channel": "email", "enabled": true,  "source": "default" },
    { "type": "marketing_email",     "channel": "email", "enabled": false, "source": "override" },
    "... 6 more"
  ],
  "quietHours": { "start": "22:00", "end": "08:00", "timezone": "Europe/Berlin" }
}
```

- `source: "default"` — значение пришло из системного дефолта.
- `source: "override"` — пользователь явно его выставил.
- `quietHours` = `null`, если не настроено.

### `POST /users/:id/preferences`

Частичное обновление. Минимум одно из полей: `toggles` или `quietHours`.

**Body:**
```json
{
  "toggles": [
    { "type": "marketing_email", "channel": "email", "enabled": false }
  ],
  "quietHours": { "start": "22:00", "end": "08:00", "timezone": "Europe/Berlin" }
}
```

- `toggles` — upsert по `(userId, type, channel)`. Идемпотентно: повторный одинаковый POST даёт тот же результат и не создаёт «шума» в `preferences.changed` (diff пустой).
- `quietHours: null` — **явно очищает** окно тишины.
- Поле опущено → не трогается (semantically *absent ≠ null*).

**Response 200:** тот же `EffectivePreferencesView`, что и `GET`.

### `POST /evaluate`

Решение для конкретного отправления.

**Body:**
```json
{
  "userId": "alice",
  "notificationType": "marketing_push",
  "channel": "push",
  "region": "EU",
  "datetime": "2026-06-15T21:30:00Z"
}
```

`datetime` — ISO-8601 c offset (валидируется через `z.iso.datetime({ offset: true })`), всегда трактуется как UTC instant.

**Response 200:**
```json
{ "decision": "deny", "reason": "quiet_hours" }
```

| `decision` | `reason` |
|---|---|
| `deny` | `blocked_by_global_policy`, `disabled_by_user`, `disabled_by_default`, `quiet_hours` |
| `allow` | `allowed` |

### Коды ошибок

| Status | code | Когда |
|---|---|---|
| 400 | `validation_error` | Zod-валидация тела/параметров |
| 400 | `invalid_*` (доменные) | Невалидные значения после Zod (например, неизвестная IANA-таймзона) |
| 404 | `not_found` | Неизвестный маршрут |
| 409 | `conflict` | Зарезервировано для будущих доменных конфликтов |
| 500 | `internal_error` | Неожиданная ошибка — сообщение не утекает в prod, всё пишется в structured log |

---

## Архитектура

### Выбор: **Hexagonal lite (Ports & Adapters)** без DI-фреймворка

В терминах задачи сервис — небольшой, но с нетривиальной **бизнес-логикой** (приоритеты решения, окно тишины с DST, deny-wins-политики). Главная угроза для качества — спутать домен с инфраструктурой и в итоге не суметь покрыть правила тестами без БД.

Поэтому код разрезан на четыре слоя:

```
src/
├── domain/          ← чистые типы и правила. Ноль зависимостей от Prisma/Fastify.
├── application/     ← use-cases + Ports (интерфейсы репозиториев и Logger).
├── infrastructure/  ← Prisma-репозитории, pino, config, SystemClock. Реализации портов.
└── http/            ← Fastify-роуты + Zod-схемы + errorMapper. Тонкий слой.
```

`src/index.ts` — единственное место «композиционного клея»: грузим config → создаём pino → Prisma → 3 репозитория → `buildServer({ repos, ... })` → `listen`.

#### Почему именно так, а не…

| Альтернатива | Почему отвергнута |
|---|---|
| **«Стандартный» MVC** (controllers / services / models с прямым импортом ORM) | Бизнес-правила (`evaluate`, `QuietHours`) пришлось бы тестировать через БД; время прогона тестов и поверхностные ошибки слоя HTTP скрывали бы доменные баги. |
| **Полный Clean Architecture / DDD** с агрегатами, доменными событиями, репо-фабриками | Оверинжиниринг. Для 3-х entity и 3-х use-cases — лишний код без выигрыша. Явно противоречит требованию «без оверинжиниринга». |
| **Vertical slices / feature folders** | Меньше пользы, когда use-cases переиспользуют одну и ту же модель (overrides) и одни и те же репозитории. |
| **DI-контейнер (tsyringe/inversify)** | Граф зависимостей плоский, 3 репозитория и один логгер. Ручная композиция в `index.ts` короче, прозрачнее, не требует декораторов и метаданных. |
| **NestJS** | Тонна boilerplate ради «модулей», которые здесь не нужны. Fastify «голый» отдаёт сравнимую DX при ×3 меньше кода и в 2-3 раза быстрее по latency. |

### Контракт между слоями

`application/ports.ts` объявляет интерфейсы, которые домен/use-cases **импортируют как типы**:

```ts
export interface PreferencesRepository {
  getOverrides(userId: UserId): Promise<readonly PreferenceRecord[]>;
  getQuietHours(userId: UserId): Promise<QuietHours | null>;
  upsertOverrides(userId: UserId, items: readonly PreferenceRecord[]): Promise<void>;
  setQuietHours(userId: UserId, qh: QuietHours | null): Promise<void>;
}
export interface DefaultsRepository { getAll(): Promise<readonly PreferenceRecord[]> }
export interface PolicyRepository   { findApplicable(t, r): Promise<readonly GlobalPolicy[]> }
export interface Logger { info(...); warn(...); error(...); /* pino-compatible */ }
```

Реализации — в `infrastructure/db/repositories/Prisma*Repository.ts`. Routes передают per-request `req.log` (pino child) как `Logger`-порт — все логи use-case автоматически получают `reqId`.

### Граф зависимостей

```
domain  ←  application  ←  infrastructure
                      ↖     ↑
                        http
```

Стрелки идут только в сторону домена. Это делает домен абсолютно изолированным и unit-тестируемым без Prisma/Fastify.

---

## Модель данных

```prisma
model DefaultPreference {
  notificationType String
  channel          String
  enabled          Boolean
  @@id([notificationType, channel])
}

model UserPreferenceOverride {
  userId, notificationType, channel  → primary key
  enabled  Boolean
  updatedAt @updatedAt @db.Timestamptz
  @@index([userId])           // быстрый getOverrides(userId)
}

model UserQuietHours {
  userId @id
  startMinutes, endMinutes  Int          // 0..1439, half-open [start, end)
  timezone                   String       // IANA, валидируется Luxon
}

model GlobalPolicy {
  notificationType, region, channel?     // channel=null → wildcard
  action  "deny"                          // deny-wins
  reasonCode  "blocked_by_global_policy"
  @@index([notificationType, region])
}
```

### Сид (`prisma/seed.ts`)

- 8 defaults: `transactional_*` = true, `marketing_*` = false (по 4 канала).
- 1 политика: `marketing_sms / EU / sms` → `deny / blocked_by_global_policy`.

---

## Правила принятия решения

Чистая функция [`evaluate`](src/domain/evaluator.ts) реализует **deny-wins** с фиксированным приоритетом:

1. **Global policy** match (с учётом wildcard `channel: null`) → `deny / blocked_by_global_policy`.
2. **Эффективная запись** = `override ?? default`. Если её нет → `deny / disabled_by_default`.
3. Если эффективная запись `enabled = false` → `deny / disabled_by_user` (или `disabled_by_default`, если источник — default).
4. **Quiet hours**: применяется только к типам, у которых `RESPECTS_QUIET_HOURS[type] = true` (по дизайну — все `marketing_*`). При `containsInstant(datetime) === true` → `deny / quiet_hours`.
5. Иначе → `allow / allowed`.

### Quiet hours и DST

`QuietHours` ([src/domain/quietHours.ts](src/domain/quietHours.ts)) хранит **минуты с полуночи** (`0..1439`) и таймзону, а не абсолютный UTC-интервал. Это корректно работает с:

- **Wrap-around окнами** `[22:00, 08:00)` через полночь.
- **DST spring-forward** (час «исчезает», переход без сбоев).
- **DST fall-back** (час «повторяется», `02:30` встречается дважды — оба раза внутри окна).
- **Half-open semantics** `[start, end)`: `end == start` → пустой интервал.

Конвертация в локальное время делается Luxon-ом на каждом вычислении — это компромисс в пользу простоты против микро-оптимизации (см. [Решения и trade-offs](#решения-и-trade-offs)).

---

## Тестирование

### Unit-тесты (`npm test`)

27 тестов в `tests/unit/`, прогон ~0.4 s, **без БД**:

- [defaults.test.ts](tests/unit/defaults.test.ts) — merging overrides+defaults.
- [quietHours.test.ts](tests/unit/quietHours.test.ts) — границы 0/1439, wrap-around, DST spring/fall, валидация TZ/HH:mm, half-open.
- [evaluator.test.ts](tests/unit/evaluator.test.ts) — все 5 веток приоритета + инвариант `RESPECTS_QUIET_HOURS` + edge-cases (`channel: null` wildcard, region mismatch, отсутствующий default).

Coverage — `v8`, scope: `src/domain/**` + `src/application/**` (HTTP/infra покрываются integration-тестами).

### Integration-тесты (`npm run test:int`)

[`tests/integration/api.test.ts`](tests/integration/api.test.ts) — реальный Postgres через [Testcontainers](https://node.testcontainers.org/), `prisma migrate deploy` + seed, обращения через `app.inject(...)` (без сети):

- Получение defaults для нового пользователя.
- Идемпотентность POST toggles.
- Установка + очистка quiet hours.
- Полная decision-matrix `/evaluate` (QH, policy, transactional bypass, policy-vs-override).
- Все 400-валидации.

Требование — рабочий Docker daemon на машине разработчика / CI-раннере.

### CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))

4 параллельные job-ы: `lint` (eslint + prettier + tsc), `test-unit`, `test-integration`, `docker-build` (через buildx с GHA-кэшем). Concurrency-группа отменяет устаревшие прогоны при новых коммитах.

---

## Observability и метрики

- **Structured logging** через pino. В dev — `pino-pretty`, в prod — JSON по строке.
- Каждый запрос получает `reqId` (из `x-request-id` или UUID). Заголовок эхо-возвращается клиенту. Все логи use-case'ов наследуют `reqId` через `req.log` child-logger.
- **Audit-события** на доменном уровне:
  - `notification.evaluated` — `{userId, type, channel, region, datetime, decision, reason}`.
  - `preferences.changed` — `{userId, toggleDiff, quietHoursDiff, toggleChangeCount, quietHoursChanged}`. Пустой diff не «спамит» — поле остаётся, но видно, что изменений нет.

### Готовность к Prometheus

В местах принятия решений и обновлений оставлены маркеры:

```ts
// METRIC: counter notifications_evaluated_total{decision,reason}
// METRIC: counter preferences_updated_total{user}
```

Подключение `@fastify/metrics` или ручного `prom-client` под эти маркеры — точечное и не требует архитектурных изменений. Хелсчек уже разнесён с метриковым endpoint (`/healthz` отдельно, ready для `/metrics` рядом).

---

## Project layout

```
.
├── prisma/
│   ├── migrations/           # SQL миграции под контролем версионирования
│   ├── schema.prisma
│   └── seed.ts               # defaults + sample policy (идемпотентный upsert)
├── src/
│   ├── domain/               # Чистые типы и правила (evaluator, quietHours, types, errors)
│   ├── application/          # Use-cases + Ports (interfaces only)
│   ├── infrastructure/
│   │   ├── config.ts         # Zod-валидированный env, fail-fast
│   │   ├── logger.ts         # pino setup
│   │   ├── clock.ts          # Clock-порт (для будущих time-travel тестов)
│   │   └── db/               # PrismaClient + Prisma*Repository
│   ├── http/                 # Fastify server, routes, Zod schemas, errorMapper
│   └── index.ts              # Composition root + graceful shutdown
├── tests/
│   ├── unit/                 # Без БД, Vitest
│   └── integration/          # Testcontainers + Postgres
├── docs/Plan.md              # Пошаговый план реализации (history)
├── Dockerfile                # Multi-stage build
├── docker-compose.yml        # postgres + app, healthchecks
├── entrypoint.sh             # migrate deploy → seed → exec node
└── .github/workflows/ci.yml  # Lint, unit, integration, docker-build
```

---

## Решения и trade-offs

| Решение | Почему |
|---|---|
| **Deny-wins** | Безопасный default для пользовательских прав: лучше «недопослать», чем нарушить privacy/compliance. |
| **Opt-in для `marketing_*`** | GDPR/комплаенс: маркетинг по умолчанию выключен; transactional — включён. |
| **Branded types** (`UserId`, `Region`) | Не путаем строки на бизнес-границах; runtime — обычная строка, без оверхеда. |
| **`exactOptionalPropertyTypes`** | TypeScript на максималках — отличает «поле отсутствует» от «поле = undefined», что критично для partial-PATCH семантики. |
| **`quietHours: null` ≠ `quietHours: undefined` в body** | `null` — явный сигнал очистить; отсутствие — «не трогай». Реализовано через `hasOwnProperty` в роуте. |
| **Idempotent upsert** для overrides и `delete` с swallow `P2025` для `setQuietHours(null)` | Повторный одинаковый POST не падает и не «мерцает». |
| **Lazy materialization дефолтов** (не дублируем defaults в `UserPreferenceOverride`) | Меньше места, нет рассинхронизации при изменении defaults. Trade-off — JOIN в памяти на чтении (8 строк, незначительно). |
| **Хранение QuietHours как `(minutes, timezone)`, не как UTC-интервал** | Корректное поведение при DST. UTC-интервал «протух» бы дважды в год. |
| **Fastify + ручная композиция** | × 2-3 быстрее по latency, явный граф зависимостей, ноль магии. |
| **Prisma 6 (downgrade с v7)** | v7 на момент работы был нестабилен в combination с Node 20 и strict-TS. Prisma 6.16 — LTS-ветка. |
| **Pino через Fastify, а не как inject-ed instance** | Fastify «владеет» логгером — снимает конфликт типов `msgPrefix: string\|undefined` под `exactOptionalPropertyTypes`. Бонус: per-request `reqId` бесплатно. |
| **Vitest вместо Jest** | Native ESM, в 2-3× быстрее, нативная поддержка TS без `ts-jest`. |
| **Testcontainers для интеграции, без mock-репозиториев** | Реальная схема, реальные миграции, реальная Prisma. Дороже по времени прогона, но ловит то, что моки никогда не поймают (constraint violations, поведение `upsert`, индексы). |
| **Multi-stage Docker, non-root, `tini` как PID 1** | Безопасность + корректная обработка SIGTERM от `docker stop` → graceful shutdown в `src/index.ts`. |
| **Sourcemaps в prod** | Размер не критичен, читаемость stack-trace бесценна. |

### Что осознанно НЕ сделано

- Аутентификация/авторизация — за пределами скоупа задачи (сервис внутренний).
- Rate limiting — точечно добавляется через `@fastify/rate-limit`, не требует архитектурных изменений.
- OpenTelemetry — оставлены `METRIC:` маркеры; полный OTel SDK — отдельная задача и зависит от инфраструктуры заказчика.
- Кэширование — `/evaluate` сейчас делает 3 параллельных query (`Promise.all`). Под нагрузкой добавляется Redis-кэш на defaults + per-user prefs с инвалидацией на `preferences.changed` — также точечно.

---

## Лицензия

MIT (тестовое задание).
