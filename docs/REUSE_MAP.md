# Карта переиспользования

Все пути ниже относительны к `vendor/qianqi/`. Точная версия — `UPSTREAM.json`.

| Блок | Исходники | Решение |
|---|---|---|
| Взвешенный выбор | `contracts/MonthlyOutcome.sol`, `scripts/monthly-outcome.cjs` | Адаптировать формулу веса; новый контекст/результат без gate 75/25 |
| BUY и история | `scripts/direct-buy.cjs`, `pons-*-buy.cjs`, `project-history.cjs` | Адаптировать интерфейс источника; текущие адреса/версии не считать актуальными для нового токена |
| Индекс | `scripts/persistent-buy-indexer.cjs`, `shared-index-config.cjs` | Переиспользовать проверки истории и состояния, конфигурацию сделать для экземпляра |
| Билеты | `scripts/attempt-lifecycle.cjs` | Адаптировать с двух lanes на один набор |
| Поздние покупки | `contracts/PurchaseRecognitionSource.sol`, `scripts/purchase-recognition.cjs` | Проверить необходимость, адаптировать привязку к экземпляру и cutoff |
| RNG | `contracts/DrandRandomAdapter.sol`, `scripts/drand-delivery-worker.cjs` | Адаптировать: текущий контракт требует двух consumers; подтвердить профиль и модель доверия |
| Транзакции | `scripts/pons-transaction-journal.cjs`, `local-receipt.cjs` | Кандидаты на перенос после проверки контракта хранения; добавить общую координацию nonce |
| Хранение | `scripts/local-scheduler-state.cjs`, `indexer-checksum.cjs` | Кандидаты на перенос: атомарность, блокировки, checksum |
| Комиссии | `contracts/LocalPonsCollector.sol`, `scripts/pons-funding-pass.cjs` | Адаптировать выбранный источник; старый split не переносить |
| Автоматика/API | `scripts/pons-automation.cjs`, `local-promo-scheduler.cjs`, `user-status-api.cjs` | Образцы восстановления и статусов; текущая оркестрация привязана к Short/Monthly |
| Интерфейс | `web/app.js`, `web/overview.js`, `web/claim.js` | Образцы кошелька/истории; конструктор и страницы платформы написать отдельно |
| Финансовое ядро | Новый код | Написать новый учёт накоплений, frozen фонда и обязательств 50/50 |
| Создание экземпляров | Новый код | Спроектировать версии, параметры, deployment progress и восстановление |

`web/i18n.js`, упомянутого в brief, нет в импортированной GitHub-версии.
Старые Solidity-контракты и тестовые контракты сохранены для компиляции fixtures:
фикстуры выбирают контракты динамически по имени. Это не выбор старого vault для платформы.
Тесты импортированы вместе с модулями, но покрывают старые правила.

Не переносились production-конфиги, секреты, кошельки, эксплуатационные журналы,
release manifests, оформление QIANQI и архив документации. `research/` содержит
только входные данные, нужные выбранным модулям/тестам; это исторические fixtures.

Дополнение08.10.2026: ShortOutcome/ShortPrizeBasket — основа нового Short.
Browser-safe адаптация scripts/short-outcome.cjs в src/draws/short-outcome.mjs;
reference-only vendor неизменён. Старые рекомендации 50/50 выше исторические;
актуальные параметры и границы — DRAW_MODULE.md.
