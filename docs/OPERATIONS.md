# Эксплуатация IGW

Актуализировано 13.10.2026, МСК. Проверка сервера была read-only;
пакет документации не публикует новый release и не меняет настройки служб.

## Рабочие компоненты

| Компонент | Назначение |
|---|---|
| `crypto-launchpad-draw.service` | Отдельный финансовый worker IGW; active при проверке |
| `/opt/crypto-launchpad/draw-current` | Ссылка на `igw-runtime-paced-20261012` |
| `/etc/crypto-launchpad/draw-runtime.json` | Реестр включённых проектов и пути секретов; не хранится в Git |
| `/var/lib/crypto-launchpad/draw/health.json` | Статус последнего завершённого прохода |
| `crypto-launchpad-draw-backup.timer` | Копия каждые 6 часов, включён в предыдущем пакете |
| `/var/backups/crypto-launchpad-draw/` | Копии БД, зашифрованного runtime и конфигурации |
| `crypto-launchpad-owner` | Отдельный owner UI; завершённый запуск не создавать заново |

Публичные проверки: [идентичность проекта](https://igw.qianqi.site/api/project),
[draws](https://igw.qianqi.site/api/draws), `/api/wallet/<address>`.
Сверять project/token/chain, время снимка, stale/service/projectionFailed,
checkpoint против finalized и состояния билетов. Нулевые билеты при
awaitingRecognition>0 не означают отсутствие покупок.

## Поведение при ожидании

- `index-catchup`: курсор догоняет finalized-историю; сравнивать продвижение по времени.
- `receipt-finality`: есть pending-транзакция; не создавать новый nonce вручную.
- `conditions`: проверить интервал, фонд, участников и конкретный draw-профиль.
- `native-balance`: пополнить нужный служебный адрес по проверенному запросу;
  призовые средства для gas не использовать.
- `project-pass-failed`, projectionFailed или stale: сверить health/journal/RPC
  без публикации сырых ошибок, которые могут содержать секретный URL.

Служба сохраняет намерение перед отправкой и продолжает после перезапуска.
Восстановление старой БД поверх новых отправок запрещено: сначала изолированная
копия, сверка policy/history/nonce/on-chain binding, отправки выключены.
Откат кода не является откатом финансового журнала.

## Ограничения

ETH пополняется вручную. Telegram-уведомления runtime ещё не подключены.
Каталожный бот и монитор локальные; закрытие компьютера не останавливает worker IGW,
но эти локальные процессы перестают обслуживать пользователей/собирать данные.
Существующий QIANQI и его финансовые службы не перезапускать в рамках работ над IGW.

Backup13.10 не создавался этим пакетом: ранее проверена копия
`20261012T164807Z` (UTC), checksum и каталог pg_restore. Полный свежий restore drill
остаётся задачей. Установка и возврат — [ops/draw-runtime](../ops/draw-runtime/README.md).
История запуска/политики и первые отправки — [отчёт](archive/reports/IGW_AUTONOMY_20261012.md).
