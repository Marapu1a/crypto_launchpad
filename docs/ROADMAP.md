# Очередь работ

2026-10-14 follow-up: [event-driven wake policy](PONS_EVENT_WAKE.md) removes the flat 30-minute RPC check for proven-idle tokens. Implemented locally; production remains c75fdb9 until a separate release. Earlier periodic-control descriptions below describe the previous policy.

**2026-10-14 production release:** shared Pons servicing is active for QIANQI and IGW, with free Alchemy RPC, persistent budget, five-minute Pons collection, both public APIs and daily verified backup. Release `c75fdb9`. QuickNode and old workers remain disabled. [Deployment evidence and limits](PONS_RELEASE_20261014.md). Earlier status paragraphs below are historical checkpoints, superseded by this release.

Актуализировано 13.10.2026, МСК. Здесь только порядок следующих пакетов;
реализованное состояние — [CURRENT_CONTEXT](CURRENT_CONTEXT.md).

## Контрольная точка: репозиторий упорядочен

Накопленный код и ассеты сохранены в 6fa15a2. Основные страницы переписаны,
исторические доказательства сохранены, решения по монитору выделены отдельно.
Проверки — [отчёт](archive/reports/REPOSITORY_CLEANUP_20261013.md).
Публикация нового release на VPS в этот пакет не входит.

## Следующий продуктовый пакет: монитор первого часа

Источник решений — [MONITOR_PRODUCT](MONITOR_PRODUCT.md).

1. Локально выполнено 13.10: первый час сохранён, кошельки рядом с числом покупок,
   объёмы, максимум со ссылкой на транзакцию, X, медиана и топ-3. [Отчёт](archive/reports/MONITOR_METRICS_20261013.md).
2. Ручное обновление, история 28 дней и экспериментальные состояния рынка реализованы
   локально. Накопить полные интервалы и проверить полезность порогов; уведомления
   и условия платного продукта ещё не настроены.
3. После локального просмотра — интеграция радара в хаб и постоянный сбор на сервере.
4. Отдельный пакет — Telegram-уведомления, подписка, ETH-счета и скидка держателям.
   Перед реализацией выбрать цену, срок и процент; серверные проверки и хранение
   платежей спроектировать отдельно. Запуск платной услуги — отдельный шаг.

## RPC: ближайший технический пакет

Приоритет 14.10: [единая модель обслуживания всех токенов](TOKEN_SERVICE_MODEL.md).
Общий расчёт интервала и [supervisor по событиям Pons](PONS_EVENT_SERVICE.md)
подключены локально; далее общий RPC-бюджет, сокращение повторных проверок
и production wiring с квалификацией бесплатного endpoint.

Уточнение владельца после аудита: доверяем данным Pons, receipt-only verifier
больше не целевой путь. [Первый пакет](PONS_PURCHASE_ACCOUNTING.md) выполнен локально.
[Адаптер и локальная репетиция](PONS_WORKER_REHEARSAL.md) реализованы: новый журнал
подключён к v2 worker/public projection только на стенде; старые начисления
сохраняются. Сравнение копий QIANQI/IGW выполнено. Production/QuickNode отключены.
[Перенос QIANQI](QIANQI_PONS_MIGRATION.md): версионированное состояние, эпохи
новых начислений, прежние форматы jobs и экономный опрос реализованы локально.
[QIANQI scheduler](QIANQI_PONS_SCHEDULER.md) подключён локально: квитанции
freeze/terminal/epoch, drand и выплаты. [Funding/projection и замеры RPC](PONS_FUNDING_PUBLIC_RPC.md)
подключены локально. Следующий пакет — сокращение повторных проверок v2,
общий бюджет/частота запросов, production wiring и отдельный release.
Публикации нового Pons scheduler уже читаются по receipts. Остановленные службы не включать.

Приоритет изменён: работа без платного RPC. Основание и критерии —
[аудит необходимости](RPC_NECESSITY_AUDIT_20261013.md). Покупки берём из Pons;
receipt-only verifier и сканирование пустых блоков не развиваем. Остаётся
оптимизировать scheduler/projection и проверить бесплатный RPC для контрактных действий.

Read/trace/send разделены локально; [проверки Alchemy](archive/reports/ALCHEMY_READ_SPLIT_20261013.md).
Далее ограниченный catch-up с учётом запросов, бюджет эксплуатации и отдельный
проверенный release. Production ещё не переключён.

## Эксплуатационные вопросы

- Перенести IGW на явно обозначенный источник Pons, сохранив старые credits,
  consumed/frozen и происхождение начислений. Не выдавать API-учёт за on-chain recognition.
- Настроить выбранный канал уведомлений об остановке worker/недостатке ETH.
- Проверить восстановление свежей копии в изолированной БД без отправок.
- Решить перенос каталожного бота на VPS; не запускать второго Telegram poller.

## Следующий токен

Имя, тикер, логотип, бюджет, правила, дата и адреса не выбраны. Нет разрешения
автоматически выпускать токен по сигналу радара. Выпускать по отдельно проверенному
профилю; наличие IGW не означает готовность произвольной конфигурации.

История прошлых этапов: [старый ROADMAP](archive/snapshots/ROADMAP.md).

14.10: [RPC gate and service loop](PONS_RPC_GATE.md) validated locally. Persistent shared-file request quota now wired to both runtime transports; Pons
production startup composition and release qualification remain pending. Production services remain stopped.

14.10: [Pons rehearsal runtime](PONS_RUNTIME.md) assembled locally with shared
budget, startup lock, gated providers, heartbeat and graceful shutdown. Full
contract cycles through this host and production activation remain pending.
