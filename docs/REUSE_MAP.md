# Карта исходников и переиспользования

Актуализировано 13.10.2026. Пути ниже относятся к этому репозиторию, кроме явно
указанного reference. `vendor/qianqi/` фиксируется в UPSTREAM.json и не редактируется.
Его тесты не доказывают корректность новой платформы.

| Область | Текущий код |
|---|---|
| Pons и owner launch | `src/pons/`, `src/launch/`, `server/owner-launch/` |
| Правила/результаты draw | `src/draws/`, `contracts/`; v2 config — `program-config.mjs` |
| Покупки, маршруты, очередь | `src/tickets/draw-ledger.mjs`, `draw-scan.mjs`, `deferred-recognition.mjs`, `draw-router.mjs` |
| Исполнение и durable journal | `server/shared/draw-worker.mjs`, `draw-sender.mjs`, `src/worker/production-journal.mjs` |
| Служба и публичные снимки | `server/short-runtime/`, `server/shared/api.mjs`, `ops/draw-runtime/` |
| Существующий QIANQI | `src/qianqi/`, `server/adapters/qianqi/`; отдельный путь от v2 |
| Сайты и каталог | `src/site-kit/`, `tokens/`, `scripts/build-token-sites.mjs`, `build-project-catalog.mjs` |
| Бот и монитор | `server/project-bot/`, `scripts/pons-monitor/` |

Short/Monthly наследуют проверяемые механики QIANQI с отдельным контекстом
экземпляра, а не старые production-настройки. Оба типа имеют собственный lifecycle
билетов. Старые предложения «свести к одному lane», «убрать Monthly gate» и 50/50
не описывают текущую реализацию.

Provenance отдельных route verifier хранится рядом с исходниками (`SOURCE.json`,
`BATCH_SOURCE.json`). Исторические источники, даты и этапы адаптации сохранены
в [прежней карте](archive/snapshots/REUSE_MAP.md) и технических документах индекса.
Ключи, кошельки, журналы и конфигурации исходного QIANQI не являются шаблонами
для новых токенов.
