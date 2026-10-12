> Исторический отчёт: результаты и ограничения относятся к дате проверки в тексте. Текущее состояние — в [CURRENT_CONTEXT](../../CURRENT_CONTEXT.md).

# IGW: подготовка исполнения и расчёт запуска

Уточнение12.10.2026: найденный маршрут и кабинет доработаны в [новом пакете](../../IGW_ROUTES_WALLET.md).
Ниже сохранён исходный снимок подготовки; это не описание готовности после доработок.

12.10.2026, исходники `c8ade35`; backend совпадает с серверным release `2abb23d`.
Владелец согласовал подготовку выключенного исполнителя и карточки расходов.
Получатели обеих долей подтверждены в [IGW_LAUNCH_PROFILE](../../IGW_LAUNCH_PROFILE.md).
Публичных транзакций, регистрации нового токена или включения исполнения нет.

## VPS: установлено, выключено

- Отдельный OS user `launchpad-draw`, без shell; Unix socket PostgreSQL через
  существующую роль `lp_executor`, без superuser/bypassrls. Добавлена только запись
  `launchpad-executor launchpad-draw lp_executor` в `pg_ident.conf`; HBA не менялся.
- Проверены 334 исходных файла server/src/contracts/config с нормализацией CRLF.
  Ссылка `draw-current` остаётся на `2abb23d`, действующий API не перезапускался.
- Установлен `crypto-launchpad-draw.service`; итоговое состояние inactive/disabled.
  Реестр `/etc/crypto-launchpad/draw-runtime.json` пуст, `allowPublicTransactions:false`.
  Smoke test с пустым реестром создал корректный health, после чего служба остановлена.
- Новые IGW executor/publisher keystores перенесены в `/var/lib/crypto-launchpad/draw`;
  пароли, выделенный RPC и socket URL находятся отдельно в `draw-secrets` с mode0600.
  Расшифровка/адреса проверены под новым OS user. Ключи QIANQI не использовались.
- Установлен `/usr/local/sbin/crypto-launchpad-draw-backup`.
  Telegram и автоматическое расписание нового backup ещё не включены.

База до изменения доступа сохранена в
`/var/backups/crypto-launchpad/igw-runtime-20261012/database.dump` и восстановлена
в отдельную `launchpad_igw_runtime_restore_20261012` с отозванным PUBLIC CONNECT.
Schema15/checksums совпали, один прежний проект, новых senders нет.
Первый restore остановился до чтения файла из-за прав каталога; исправлен передачей
dump через stdin, без изменения прав оригинала или перезаписи production.

Штатный backup выполнен в `/var/backups/crypto-launchpad-draw/20261011T214835Z`.
COMPLETE/checksums проверены, runtime archive не содержит паролей/RPC;
восстановленные encrypted keys побайтно совпали. Копия скачана и проверена:
`.local/igw-launch-prep/offserver-backup/20261011T214835Z/`.
Эта копия сделана до появления owner journal; после подписей нужен новый backup.

PID QIANQI automation1112076/indexer1112057 и API883504/1139953 не изменились.
Отдельный owner signing server ещё не установлен; fake policy/domain/sender не создавались.

## Девять шагов и расходы

Частная in-process копия текущего Pons, реальный адрес владельца impersonated
только внутри Hardhat; публичный provider использован исключительно для чтения.
Модель finality=latest ускоряет репетицию и не измеряет время настоящего запуска.
Все девять шагов завершены: Short+RNG, router, splitter, collector, recognition,
два пополнения, Pons launch и bind. Исполнение после этого осталось выключенным.
Одинаковый получатель team/operations прошёл эту репетицию.

| Состав | ETH |
|---|---:|
| Комиссия Pons | 0.00050000 |
| Газ девяти шагов по цене наблюдения, запас20% | 0.00029070 |
| Черновой резерв executor | 0.01000000 |
| Черновой резерв publisher | 0.00100000 |
| Итого по черновику | 0.01179070 |
| Баланс владельца в снимке | 0.00893208 |
| Разница в снимке | 0.00285862 |

Резервы остаются средствами служебных кошельков, не являются ценой deployment.
Суммы не утверждены и не отправлены. Общий потолок0.05ETH также остался черновым.
Дополнительная живая `eth_estimateGas` первого Short deployment на блоке86162747:
5176745gas при20,000,000wei/gas, с запасом0.00012424188ETH. Полная смета опирается
на локальную репетицию; каждый публичный шаг требует свежей оценки кошелька.

Условия Pons прочитаны на86161667: launch fee0.0005ETH, base fee100bps,
creator cap1000bps, canLaunch=true. Черновик IGW: creator fee2%, USDG,
24ч/10USDG на билет/фонд50USDG/одно место/80-15-5, openingBuy0.
Метаданные и IPFS пока не окончательные: технический placeholder использован
только для измерения газа, его нельзя переносить в реальный запуск.

Ориентир резерва: прежняя локальная репетиция другого Short-профиля
`.local/test-results/owner-draw-2026-10-10T23-53-16-943Z/report.json`:
19 операций executor стоили0.002924138339264633ETH, две publisher —
0.000092935941620648ETH. Другие цена газа/условия; не прогноз расхода IGW.

## Что проверка обнаружила до подписей

1. **Покупки через Pons ещё покрыты не полностью.** V2 route decoder использует
   direct USDG и opening buy. V2 policy не допускает optional batchExecutor,
   проверенный для v1. Native/aggregator routes также не перенесены.
   Источники: `src/worker/draw-policy.mjs`, `src/tickets/draw-recognition.mjs`,
   `src/tickets/production-recognition.mjs`.
2. Read-only выборка на finalized86152544
   (`0x02b5eef93238a6ce3efaa943f6dcb8f88cfb3b9c5aeb638813e598fd55f46b1e`):
   160 CurveBuy logs за10000блоков, просмотрены последние150. Найден один
   USDG/Pons пример, не оценка распространённости маршрутов.
   Транзакция `0xf316b1a272f708379d5ba96f086ea1a1205225390ec920c5aa9c3d8044b6c52c`
   на86149336 направлена на `0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc`.
   Текущий v2 decoder возвращает `UNSUPPORTED_ROUTE/NOT_DIRECT_CURVE_CALL`.
   Это подтверждённый пробел, а не ошибка пользователя или отсутствие BUY.
3. **IGW frontend пока prelaunch.** `tokens/IGW/site/live.js` читает project/draws
   и показывает общие суммы; подключения кошелька, персональных билетов и
   проверенного пути покупки ещё нет. Нельзя объявлять кабинет готовым.
4. До выпуска нужны адаптеры реальных маршрутов, сквозная проверка начислений,
   интерфейс участия, окончательные metadata/бюджет. После deployment — bind/policy,
   hostname, handoff проекта, уведомления и явная активация.

## Артефакты и следующий пакет

Локальная карточка: http://127.0.0.1:4195/ (только просмотр, loopback).
Проверена в Chromium390/1440px. Каталог HTTP содержит только HTML, без конфигов/ключей.
Результаты: `.local/igw-launch-prep/` — budget.json, live-estimate.json, terms.json,
routes.json, installation.json, backup-check.json и screenshots. Скрипты бюджетной
репетиции и проверки сохранены там же; первоначальные сбои harness не были
публичными отправками. Итоговый budget statusPASS.

Следующий необходимый пакет: перенести подтверждённые route verifiers в профиль
новых токенов, закрыть найденный пример и соседние случаи, затем соединить IGW
с персональными билетами/кошельком. Контракты до этого не подписывались.


12.10.2026: после уточнения владельца добавлена [общая очередь покупок](../../DEFERRED_PURCHASE_RECOGNITION.md). Неизвестные маршруты сохраняются для позднего начисления, а не считаются обязательным препятствием запуску. Перед созданием нового owner journal проверить `purchaseAccounting: deferred-purchases-v1`; на сервере этот пакет ещё не установлен.
