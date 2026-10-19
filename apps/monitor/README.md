# Монитор Pons

Из корня: `npm run monitor` (127.0.0.1:4196).
Проверки: `npm run test:monitor`, `node tests/studio/pons-monitor.mjs`.

`monitor.py` — сборщик и HTTP; `market_history.py` — история/сравнения;
`index.html` — экран. Данные по-прежнему в `.local/pons-monitor` относительно корня.
Не запускать одновременно два сборщика с одной базой/портом.

Переезд не меняет правила сбора, API и данные. Для процесса, запущенного до переезда,
локально оставлен игнорируемый HTML по старому пути. После остановки старого процесса
следующий запуск выполняется из apps/monitor.

Обновление 16.10 после переезда: [надёжный сбор и наблюдения](../../docs/MONITOR_RELIABILITY_20261016.md).
Кнопка теперь читает кеш без запуска сбора. Новый runtime восстанавливает доступные
35 минут, сохраняет попытки/полноту и защищает каталог OS-lock. Перед переключением
со старого процесса остановить его; исходную базу сохранить через SQLite backup API.
Параметры: `--data-dir PATH`, `--port NUMBER`. Шаблон серверной установки:
[ops/market-monitor](../../ops/market-monitor/README.md).

Текущее поведение: [MONITOR_PRODUCT](../../docs/MONITOR_PRODUCT.md).
Согласованное развитие: [решения 16.10](../../docs/MONITOR_DECISIONS_20261016.md).

## Read-only visual preview

`python scripts/preview-monitor.py --snapshot PATH --port 4217` serves the monitor
UI against an explicit saved JSON snapshot. It adds a preview label, preserves
original timestamps, and never starts a collector. Wallet network lookups are not
provided by this preview. The regular monitor server is unchanged.

The overview uses four aligned bar charts. Height represents count; green/red
means more/fewer than the immediately preceding complete interval. Neutral filled bars mean equal counts; dashed outlines mean no valid comparison. Incomplete counts are striped. The dashed mean uses
six complete intervals before the latest displayed interval and disappears if any
are missing. Selecting a time highlights it in all rows and updates the token table.

On phones one selectable metric shows all seven intervals without side scrolling.
Data freshness and missing-data messages appear next to the counts. The selected summary shows the exact count and preceding 30-minute mean when available. Wallet navigation refers to the latest snapshot, not token-specific
buyer lists. Colours describe activity, not price forecasts.
