# Документация

Упорядочено13.10.2026, МСК. Не требуется перечитывать весь архив перед каждой задачей.

## Актуальные страницы

- [Текущий контекст](CURRENT_CONTEXT.md).
- [Правила продукта](PRODUCT_SPEC.md).
- [Границы платформы](PLATFORM_SCOPE.md).
- [Очередь работ](ROADMAP.md).
- [Монитор первого часа и уведомления](MONITOR_PRODUCT.md).
- [Эксплуатация IGW](OPERATIONS.md).
- [Проверки и пределы доказательств](TESTING.md).
- [IGW: выпущенный профиль](IGW_LAUNCH_PROFILE.md).
- [Модуль розыгрышей v2](DRAW_MODULE.md).
- [Исполнитель v2](DRAW_WORKER.md).
- [Карта исходников и переиспользования](REUSE_MAP.md).

## Технические материалы

Материалы ниже содержат устройство модулей и результаты конкретных пакетов.
Их старые статусы, тестовые числа и «следующие шаги» относятся к указанной дате.
Текущая готовность определяется CURRENT_CONTEXT, очередь — ROADMAP.

### Pons и выпуск

- [Новый токен: UI → Pons → общий backend](NEW_TOKEN_STUDIO.md).
- [Цикл v2 на токене, созданном владельцем](OWNER_DRAW_CYCLE.md).
- [Адрес сайта и логотип в форме запуска](OWNER_LAUNCH_ASSETS.md).
- [Запуск Short через кошелёк с серверным журналом](OWNER_LAUNCH_FLOW.md).
- [Подготовка обслуживания из owner UI](OWNER_RUNTIME_HANDOFF.md).
- [Цикл токена владельца в локальном стенде](OWNER_TOKEN_CYCLE.md).
- [Кошелёк и IPFS: первый интеграционный пакет](OWNER_WALLET_IPFS.md).
- [Базовая версия запуска через Pons](PONS_BASELINE.md).
- [Возможности Pons для нашего конструктора](PONS_CAPABILITIES.md).
- [Покрытие базового запуска Pons](PONS_COVERAGE.md).
- [Pons: направление и первичная сверка](PONS_DISCOVERY.md).
- [Pons: Holders, комиссии и opening buy](PONS_FEE_FLOW.md).
- [Картинки через Pons](PONS_IMAGE_UPLOAD.md).
- [Редактирование карточки Pons — исследование 12.10.2026](PONS_METADATA_EDIT.md).

### Покупки, финансы и инфраструктура

- [Учёт покупок по данным Pons](PONS_PURCHASE_ACCOUNTING.md).
- [Pons → исполнитель: локальная интеграция и перенос истории](PONS_WORKER_REHEARSAL.md).
- [QIANQI: перенос учёта Pons и экономный опрос](QIANQI_PONS_MIGRATION.md).
- [QIANQI: локальный полный цикл Pons → розыгрыши → выплаты](QIANQI_PONS_SCHEDULER.md).
- [Pons: funding, public snapshots and RPC budget](PONS_FUNDING_PUBLIC_RPC.md).
- [Shared token service model: QIANQI, IGW and future tokens](TOKEN_SERVICE_MODEL.md).
- [Pons event service and receipt-based publications](PONS_EVENT_SERVICE.md).

- [Аудит необходимости RPC: без платной подписки](RPC_NECESSITY_AUDIT_20261013.md).

- [Отложенное распознавание покупок](DEFERRED_PURCHASE_RECOGNITION.md).
- [Первый экземпляр: проект графа запуска](DEPLOYMENT_BLUEPRINT.md).
- [Проверяемая случайность Short — 08.10.2026](DRAND_SHORT.md).
- [Сборка и проверка связей v2](DRAW_BUILD_POLICY.md).
- [Конфигурация v2 и расчёт фондов](DRAW_FUNDING_MODEL.md).
- [Общий распределитель призовых поступлений](DRAW_FUNDING_ROUTER.md).
- [Сохраняемый запуск v2: три режима](DRAW_OWNER_LAUNCH.md).
- [Локальный конструктор и публичные данные v2](DRAW_OWNER_UI.md).
- [Short + Monthly: схема переноса](DUAL_DRAW_PLAN.md).
- [Разделение комиссий — локальный пакет 08.10.2026](FEE_SPLIT.md).
- [IGW: publication and backend connection](IGW_BACKEND_CONNECTION.md).
- [IGW: маршруты покупок и личные билеты — 12.10.2026](IGW_ROUTES_WALLET.md).
- [Инкрементальный реестр билетов](INCREMENTAL_TICKET_LEDGER.md).
- [Позднее начисление билетов — локальный пакет 08.10.2026](LATE_RECOGNITION.md).
- [Локальное исполнение Short — 08.10.2026](LOCAL_SHORT_EXECUTION.md).
- [Проверка с компьютера и свежесть off-server копий](LOCAL_WATCHDOG.md).
- [Постоянный исполнитель Short — 08.10.2026](LOCAL_WORKER.md).
- [Monthly: контрактный цикл и резервы](MONTHLY_CONTRACT_CYCLE.md).
- [Финансовый журнал PostgreSQL — локальный транспорт](POSTGRES_FINANCIAL_JOURNAL.md).
- [Полный локальный worker с PostgreSQL](POSTGRES_LOCAL_WORKER.md).
- [USDG/Short: контракты 4663, PostgreSQL sender и ключи](PRODUCTION_SHORT_CONTRACTS.md).
- [USDG/Short: автоматический цикл нового шаблона](PRODUCTION_SHORT_WORKER.md).
- [Общий бэк: первый этап изоляции — 09.10.2026](SHARED_BACKEND_BASELINE.md).
- [Общий приём данных цепочки](SHARED_READ_PIPELINE.md).
- [Общий сервер: обследование и план размещения](SHARED_SERVER_PLAN.md).
- [Билеты поверх общей истории: локальное shadow-сравнение](SHARED_TICKET_SHADOW.md).
- [Ожидание газа и Telegram](SHORT_GAS_NOTIFICATIONS.md).
- [Постоянное обслуживание нового Short](SHORT_RUNTIME_SERVICE.md).
- [Покупки Pons → билеты Short — 08.10.2026](TICKET_INDEXER.md).
- [Валидация базового запуска](VALIDATION.md).

### Существующий QIANQI

- [QIANQI: backup failure detection и операторская тревога](QIANQI_BACKUP_SAFETY.md).
- [Existing QIANQI adapter](QIANQI_EXISTING_ADAPTER.md).
- [QIANQI: историческая сверка RNG и обязательств](QIANQI_FINANCE_SHADOW.md).
- [QIANQI: история покупок и снимки Short](QIANQI_HISTORY_REPLAY.md).
- [QIANQI: обновляемый shadow с курсором PostgreSQL](QIANQI_LIVE_SHADOW.md).
- [QIANQI: независимый пересчёт исходов Short](QIANQI_OUTCOME_REPLAY.md).
- [QIANQI: согласованное восстановление native + PostgreSQL](QIANQI_PAIRED_RECOVERY.md).
- [QIANQI: импорт исторического состояния в общий PostgreSQL](QIANQI_POSTGRES_IMPORT.md).
- [QIANQI: read-only inventory и границы совместимости](QIANQI_READONLY_INVENTORY.md).
- [QIANQI: проверка маршрутов выборки53](QIANQI_ROUTE_REPLAY.md).
- [Единственный финансовый исполнитель QIANQI](QIANQI_SINGLE_WRITER.md).
- [QIANQI: read-only сверка учёта билетов](QIANQI_TICKET_SHADOW.md).

### Сайты, бот и монитор

- [IGW public site](IGW_SITE.md).
- [Локальный монитор активности Pons](PONS_ACTIVITY_MONITOR.md).
- [Общий бот проектов](PROJECT_BOT.md).
- [QIANQI hub and first-token domain](QIANQI_HUB.md).
- [API и страница нового Short](SHORT_PUBLIC_SITE.md).
- [Футер сайтов токенов](TOKEN_SITE_FOOTER.md).
- [Переиспользуемые сайты токенов](TOKEN_SITE_KIT.md).

## История и эксплуатационные инструкции

- [Архив отчётов и прежних основных страниц](archive/README.md).
- [Первоначальный brief](../PLATFORM_START.md) — исторический источник, не текущие правила.
- [Установка/backup draw runtime](../ops/draw-runtime/README.md).
- [Правила работы в репозитории](../AGENTS.md).

## Как поддерживать порядок

Текущий контекст — короткий снимок с датой и незакрытыми вопросами. Решения продукта
хранятся в PRODUCT_SPEC и документах модуля; предложения отмечаются отдельно.
Новый результат оформляется отдельным датированным отчётом с источниками и пределами
проверки. Старые снимки не заменяются незаметно. Секреты и подробные локальные логи
остаются в игнорируемом `.local/`. Ссылки на него — указатели для владельца,
а не обещание наличия этих данных в публичном checkout.

- [Shared Pons runtime and validation](PONS_RUNTIME.md)
- [Pons release and rollback procedure](PONS_RELEASE.md)
