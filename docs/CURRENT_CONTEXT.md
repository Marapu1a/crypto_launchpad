# Текущий контекст

2026-10-14 follow-up: [event-driven wake policy](PONS_EVENT_WAKE.md) removes the flat 30-minute RPC check for proven-idle tokens. Activated on the server as e2731ea at 15:37 UTC; both projects entered event-only sleep with nextCheckAt=null. Alchemy remains the sole allowed RPC host. Earlier periodic-control descriptions below describe the previous policy.

**2026-10-14 production release:** shared Pons servicing is active for QIANQI and IGW, with free Alchemy RPC, persistent budget, five-minute Pons collection, both public APIs and daily verified backup. Release `e2731ea` (event-driven wake). QuickNode and old workers remain disabled. [Deployment evidence and limits](PONS_RELEASE_20261014.md). Earlier status paragraphs below are historical checkpoints, superseded by this release.

14.10: зафиксирована [общая модель обслуживания токенов](TOKEN_SERVICE_MODEL.md).
Тайминг v2, прежнего QIANQI adapter и локального Pons scheduler использует общий
модуль. [Supervisor по изменениям Pons](PONS_EVENT_SERVICE.md) подключён локально:
пустые ticks не вызывают RPC, публикации QIANQI проверяются по receipts.
Общий RPC-бюджет и production wiring ещё впереди.

**Приоритетный статус 13.10.2026:** RPC-потребители production остановлены по
просьбе владельца; описанное ниже состояние запуска 12.10 — исторический снимок.
QuickNode не опрашивать. [Локальная репетиция Pons](PONS_WORKER_REHEARSAL.md):
адаптер v2 worker/projection и сравнение сохранённых данных готовы.
14.10: [перенос QIANQI](QIANQI_PONS_MIGRATION.md) готовит прежние форматы jobs,
сохраняя epochs/consumed/frozen; тихий опрос локально замедлен до пяти минут.
[Локальный планировщик](QIANQI_PONS_SCHEDULER.md) подключает учёт Pons к прежним
исполнителям и квитанциям контроллеров. [Комиссии и публичный снимок](PONS_FUNDING_PUBLIC_RPC.md)
подключены локально: sweep/escrow → collector → vault, API без RPC на запрос посетителя.
Production wiring, реальная миграция и публикация не выполнены; остаётся
подключить production supervisor/бюджет и сократить повторные проверки v2.

Сверка документации: 13.10.2026, МСК. Основание: код поверх c50337a,
результаты проверок текущего пакета и read-only чтение сервера/API
12.10.2026 около 23:59 МСК (20:59 UTC). Это датированный снимок, не live dashboard.

## Что работает

- IGW выпущен: `0x341849f168833f7578c6E03a7B3Ee9eBC471082f`, chain4663.
  Девять owner-транзакций завершены, handoff и hostname зарегистрированы.
- На VPS активен `crypto-launchpad-draw`, release `igw-runtime-paced-20261012`.
  Исполнение включено для IGW. Последняя проверка: `waiting/index-catchup`, alerts пуст.
- [IGW](https://igw.qianqi.site/): подтверждённый призовой фонд **26.850336 USDG**,
  порог 50 USDG, cycle0. API: stale=false, projectionFailed=false;
  checkpoint86958768, finalized86964893. Шесть покупок ожидают recognition,
  creditedPurchases=0 и totalIssued=0. Нельзя считать билеты уже начисленными.
- Worker сам собрал и направил средства в фонд. Сканер выбирает события
  конкретного проекта и проверяет receipts; общая очередь RPC ограничивает запросы.
  Backup timer включён; сохранение pending-операции при перезапуске проверено.
- Хаб и сайты опубликованы. Каталог `tokens/hub/site/projects.json` содержит
  QIANQI и IGW как launched; отдельный бот выдаёт карточки проектов.
- Конструктор/контракты/worker v2 поддерживают Short, Monthly и оба режима.
  Сквозные тесты трёх режимов пройдены; реальный новый токен IGW использует только Short.

## Границы и незакрытые вопросы

1. Покупки IGW: последний API всё ещё показывает шесть ожидающих. Предыдущий
   read-only аудит нашёл три проверяемых маршрута и три неизвестных; он не начислял
   билеты. Требуется отдельная проверка продвижения реальной очереди.
2. ETH служебных кошельков пополняется вручную из средств обслуживания;
   автоматического пополнения нет. Telegram-оповещения draw runtime не настроены.
3. Бот каталога и экспериментальный монитор пока запускаются локально;
   они не являются круглосуточными VPS-сервисами. Worker IGW от них не зависит.
4. Проверка backup включала checksum/чтение каталога и restart; это не полный
   restore drill после последних реальных отправок.
5. Полное покрытие маршрутов Pons и общая готовность платформы не доказаны
   одним запуском IGW. Старый QIANQI имеет отдельный адаптер и эксплуатационный путь.

## Следующая работа

Репозиторий упорядочен: код/ассеты сохранены в 6fa15a2, текущие страницы отделены
от архивных. [Проверки уборки](archive/reports/REPOSITORY_CLEANUP_20261013.md).
Локальный [монитор первого часа](MONITOR_PRODUCT.md) доработан: кошельки/покупки,
объёмы, максимум со ссылкой, X, медиана/топ-3, окна5минут/с запуска.
[Проверки13.10](archive/reports/MONITOR_METRICS_20261013.md). Далее локальный просмотр,
Добавлены ручной снимок, фоновая история 28 дней и сравнения по МСК;
подробности и границы — в MONITOR_PRODUCT. Затем интеграция в хаб;
уведомления и оплата остаются отдельным пакетом.
Согласованы ETH-оплата и скидка за любой положительный баланс токена из JSON-списка;
оплата/подписки пока не существуют в коде. Цена, период и процент скидки не выбраны.

## Навигация

- [Правила](PRODUCT_SPEC.md), [план](ROADMAP.md), [эксплуатация](OPERATIONS.md).
- [Проверки](TESTING.md), [карта исходников](REUSE_MAP.md), [все документы](README.md).
- [Запуск автономного IGW: исторический отчёт](archive/reports/IGW_AUTONOMY_20261012.md).
- [Прежняя лента контекста](archive/snapshots/CURRENT_CONTEXT.md) сохранена как история.

При продолжении: прочитать этот файл, ROADMAP и `git status`; живые суммы,
очереди и состояние служб проверять заново. Не дописывать сюда хронологию каждого
шага: подробности хранить в отдельном датированном отчёте.

## RPC: текущий пакет, 13.10.2026

Последующее решение владельца: источник покупок — Pons API, без независимой
реконструкции маршрутов. [Локальный сборщик и журнал](PONS_PURCHASE_ACCOUNTING.md)
готовы: 12 тестов, полные API-истории IGW/QIANQI, по одному запросу при тихом
повторе. Сумма quoteAmount отличается от старого wallet-net-debit. Gross результаты
38/27 билетов — чистый расчёт Pons, не доступные production-билеты.
Локальный v2 worker подключён на изолированном стенде; сравнение миграции сохраняет
QIANQI 28 начисленных, Short 16 использованных/12 доступных, Monthly 28 доступных.
Адаптация прежнего QIANQI executor проверяется локальным scheduler;
реальная миграция и публикация не выполнены.

**Остановка по запросу владельца, 13.10 около 20:22 UTC:** QuickNode больше
не опрашивать, включая диагностические пробы, до нового разрешения владельца.
На VPS остановлены и отключены qianqi-public-indexer, qianqi-public-automation,
crypto-launchpad-draw, crypto-launchpad-sandbox-check; остановлен static
crypto-launchpad-owner. Для каждого создан systemd drop-in
`zzzz-rpc-disabled.conf` с `[Unit] ConditionPathExists=!/`: он запрещает запуск
также из backup scripts/зависимостей. Проверка старта indexer: ConditionResult=no,
MainPID=0. У всех пяти MainPID=0; failed у ранее упавших не означает живой процесс.
API и backups оставлены; indexer API также остановлен вместе с collector,
поэтому его потребители могут показывать недоступность, не только старые данные.
Локально среди node/python остался только Pons monitor PID1060, без RPC.
Подписка в кабинете QuickNode НЕ отменена, provider-side pause не выполнялась;
поздние начисления и расход сторонних клиентов этим не исключены.
Возобновление требует удаления только названных drop-ins, daemon-reload и
отдельного решения о запуске/enable; не делать автоматически после восстановления RPC.

Новое требование владельца: исключить платную RPC-подписку. Выполнен
[аудит необходимости](RPC_NECESSITY_AUDIT_20261013.md): trace нужен одному
маршрутному verifier, не самому draw; основная открытая задача — полное бесплатное
обнаружение событий при высокой скорости блоков. Изменений production в аудите нет.

На сервере применена пауза read-only индексатора QIANQI 60 секунд.
Последняя проверка QuickNode выявила TLS-сбой; финансовый worker QIANQI
не возобновляли. Это состояние нужно перепроверить перед восстановлением.
Локально подготовлены economy/backoff/счётчики и отдельный read provider Alchemy.
22 адресных теста разделения RPC PASS; небольшие read-only проверки на копиях
QIANQI/IGW с VPS прошли. Новый runtime НЕ опубликован. Free Alchemy ограничивает
logs десятью блоками и не даёт trace; полный catch-up и месячная квота не проверены.
Источники: [аудит нагрузки](RPC_ECONOMY_20261013.md),
[разделение RPC и пределы проверки](archive/reports/ALCHEMY_READ_SPLIT_20261013.md).

14.10: [RPC gate and service loop](PONS_RPC_GATE.md) validated locally. Persistent shared-file request quota now wired to both runtime transports; Pons
production startup composition and release qualification remain pending. Production services remain stopped.

14.10: [Pons rehearsal runtime](PONS_RUNTIME.md) assembled locally with shared
budget, startup lock, gated providers, heartbeat and graceful shutdown. Full
contract cycles through this host and production activation remain pending.
