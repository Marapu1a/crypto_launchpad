# Текущий контекст

19.10.2026. Задача — подготовить Pattern Watcher через общую платформу.
PW ещё не выпущен. Production и существующие QIANQI/IGW в текущих пакетах не менялись.

## Утверждено

- ETH-пара, creator tax 3%, полученные комиссии 60% холдерам / 20% draw / 20% проекту.
- Холдеры: периоды 30 дней от запуска, вес по принятому снимку, мелкие суммы
  накапливаются, начисленный долг сохраняется после продажи. Газ оплачивает проект.
- Розыгрыш по механике IGW: билеты за покупки, один слот, победитель не гарантирован;
  первый через 30 дней от запуска, последующие через 30 дней после завершения.
- Buyback/burn выключены. ETH-пороги утверждены: билет 0,001; фонд/приз 0,005; выплата холдеру 0,0005. Тикер пока не выбран.
- Сервис оплачивается ETH на день/неделю/месяц; скидки за холдерство и уведомления
  Telegram/Web Push/сайт — отдельный этап, не реализованная часть этого пакета.

[Правила PW](PATTERN_WATCHER_RULES.md), [профиль](../tokens/PatternWatcher/preparation.json).

## Готово локально

[Единая репетиция PW](PW_LOCAL_REHEARSAL.md): отдельный локальный launch adapter,
создание токена моделью фабрики Pons, покупки ETH, учёт билетов, collector/splitter
60/20/20, настоящий draw с исторической BLS-проверкой и два периода холдеров.

[Исполнение](HOLDER_EXECUTION.md): PostgreSQL-планы, signed bytes до отправки,
finalized receipts, отказ получателя, повторы, сверка сумм и восстановление
в новом процессе. [Периоды и восстановление](HOLDER_PERIODS_RECOVERY.md): старые долги,
прямые выплаты, отдельный импорт и диагностика частичной публикации.
Paid-сканер ограничивает диапазон и число receipts, сохраняет cursor, работает по запросу.

[Допуск снимка](HOLDER_SNAPSHOT_ADMISSION.md): Pons перечисляет адреса, баланс и
полнота проверяются на одном finalized блоке с явным бюджетом. Реальный runtime
Pons не утверждён этой локальной ERC20-проверкой.

Монитор: EN/中文/RU, интервалы, таблицы, карточки и топ кошельков, эмблема/маскот.
[Макет](MONITOR_LAYOUT_20261017.md), [продукт](MONITOR_PRODUCT.md).
[Исправления промежуточного ревью](PW_INTERIM_FIXES_20261018.md) сохранены.

[Полный запуск через Pons и восстановление](PW_LAUNCH_RECOVERY_20261019.md) проверены
на локальном fork: девять шагов, постоянный журнал, начало draw от фактического
запуска токена. Для холдеров утверждён первый успешно принятый снимок после 30 дней;
пропущенные календарные периоды переносят свободные средства. Публичный запуск и
подключение к рабочим службам пока закрыты.

## До реального запуска

1. Выбрать газовый бюджет, тикер и адреса исключений. [ETH-пороги проверены](PW_ETH_ADMISSION_20261018.md): точные границы и накопление между периодами.
2. Минимальное управление holder-фондом реализовано локально: [пауза и смена publisher](HOLDER_GOVERNANCE.md). Реальные роли/адреса выбрать перед запуском.
3. [Factory/helper/token Pons сверены](PW_ETH_ADMISSION_20261018.md), ETH-симуляция принята. Полный PW graph проверен на fork; cutoff и перенос утверждены. Остался production admission.
4. Газ измерен; [оператор PW](PW_OPERATOR.md) реализует production-профиль, журнал
   отправок, holder-handoff и сверку порциями. Остались реальные настройки
   и подключение к форме запуска. Локальный adapter не является готовой публичной кнопкой запуска.
5. Разобрать готовность с владельцем; выпуск и реальные переводы — отдельная задача.

[Порядок работ](ROADMAP.md). Полные ограничения и команды — в документах модулей.
Известное прежнее состояние QIANQI/IGW описано в [релизе](PONS_RELEASE_20261014.md);
текущий пакет не выполнял свежую проверку сервера. Исторические отчёты — в archive.

## Holder gas check — 19.10.2026

[Measured local gas and scaling limits](HOLDER_GAS_BENCHMARK.md): PASS for 10/100/500/1,000/5,000 recipients; payouts sampled, totals extrapolated. Resumable reconciliation and actual-network cost preview are now implemented in the PW operator package; production configuration and activation remain pending. No production changes or new financial rules.

## PW operator package — 19.10.2026

[Working launch and holder operator](PW_OPERATOR.md): production profile and disabled-by-default send switch, gas quote, durable exact-byte broadcast/recovery, finalized holder handoff, on-demand holder operations and paged reconciliation (migration 020). No production activation. Next: choose real launch settings, connect owner signing/UI, then complete deployment rehearsal/review. The existing IGW runtime is not a drop-in PW worker.

## PW service — 19.10.2026

[Сбор комиссий и draw PW](PW_SERVICE.md) подключены отдельным адаптером общего
Pons runtime. При простое RPC не вызывается; активность, срок draw и незавершённая
операция запускают проход. Подтверждённые поступления импортируются в holder ledger.
Регистрация службы отделена от активации. Дальше: owner UI/подпись, реальные
настройки запуска, итоговая репетиция и ревью. Холдеры обслуживаются через operator.
