# PW: установка общего бюджета газа

21.10.2026. Код `151dcdc`, release
`/opt/crypto-launchpad/releases/gas-151dcdc-20261021`.
Владелец разрешил установку и preflight; выпуск и реальные переводы не выполнялись.

## Установлено

- PW console и общий Pons runtime переключены отдельными drop-in
  `96-gas-20261021.conf`; manifest проверен перед стартом.
- Только PW-база `pattern_watcher`, PostgreSQL 18/pw на 5434: миграция 023.
  Identity/hash/revision журнала запуска не изменились; RLS/FORCE RLS включены.
- Backup `/root/gas-20261021/pattern_watcher.dump`, 0600; SHA-256
  `46a2c7d1a08014287e71e30bf6257cb0db6017a0bf627476a79025ff5f381105`.
  Восстановление в отдельную временную БД прошло; временная БД удалена.
- Приватный `operator.gas-20261021.json`: согласованный общий бюджет
  0.001 ETH / 30 дней, service 6.5m gas, holder 4m gas, fee cap 0.042 gwei,
  остаток 0.0001 ETH. Профиль запуска не изменён. Подпись/отправки выключены.
- Ops monitor использует новый код через `zzzzz-gas-20261021.conf`,
  существующие credentials, timer и dedup-state сохранены. Тестовых сообщений
  не отправляли; штатная проверка сообщает `Pons operational checks: ok`.
- PW ещё не добавлен в активные проекты runtime. Регистрация бюджета с реальным
  launchAt выполняется при handoff после выпуска; наличие таблиц не означает
  запущенное обслуживание.

## Финальная проверка без подписи

08:58 UTC, Robinhood Chain 4663, RPC `robinhood-mainnet.g.alchemy.com`.
Finalized block 94150534,
`0x256ef3169a5ed74d6286ab6c9a49fbd1e6610a784fa26849eb33b30e19d9b5f5`.

| Роль | Адрес | ETH |
|---|---|---:|
| Owner/project | `0x098afA6731239a00CE0aff669aaefD16b7C72114` | 0.008055362290600187 |
| Executor | `0x9083FF89eaa43f6442471A66a917579C7a482D74` | 0 |
| Publisher | `0x8A9Fa285A82aaDBF3aC7030eC6Ec9edd6a068A11` | 0 |

Обычный quote первого vault прошёл: estimate 1 833 118 gas, limit 2 199 742,
maxFee 40 128 000 wei, верхняя стоимость шага 0.000088271246976 ETH.
Это оценка первого шага, а не фактическая стоимость всего выпуска.
Launch cap 0.003 ETH и резервы 0.001/0.0005 ETH не изменены; баланс owner
покрывает их суммарные 0.0045 ETH с запасом. Резервы пока не переводились.

Preflight использовал 45 RPC через общий сохраняемый бюджет с защищённым
остатком 1000, без отключения штатной проверки сети. Первая попытка локального
диагностического процесса остановилась до RPC из-за отсутствующего
`CREDENTIALS_DIRECTORY`; повтор выполнен с правильным окружением существующих
systemd credentials, права файлов не ослаблялись.

Источник результата:
`/var/lib/crypto-launchpad/pons-preflight/pw-gas-final-preflight-20261021.json`.
PW: prepared, history=0, pending=null; authorizationToSend=false.

## Проверка служб

08:59:31 UTC: свежий health обоих проектов QIANQI/IGW —
`waiting/service-sleep`, ran=false. Общая квота 330/2000, из них 45 — preflight,
285 — запуск runtime; в последующем простое счётчик не вырос. Окно обновилось
штатно после истечения часа; ручного сброса не было, владелец qianqi, режим 0600.
PW console, runtime, collector, market monitor, web gateway и Telegram bot —
active/running, NRestarts=0. Главная и `/wallets` — HTTP 200.

## Откат и оставшиеся шаги

Для отката кода остановить нужный сервис, проверить завершение процесса/lock,
убрать только его `96-gas-20261021.conf`, выполнить daemon-reload и старт.
Для monitor убрать только `zzzzz-gas-20261021.conf`. Прежние drop-in сохранены;
PW вернётся к прежнему fee42 config. БД и RPC ledger не откатывать и не обнулять.
Снимки units, backup и результаты находятся в `/root/gas-20261021`.

До финансового запуска требуется отдельное разрешение на подписи и переводы.
После finalized выпуска проверить реальный token runtime, разрешить адреса
исключений и зарегистрировать holder/service handoff перед активацией.
Публичные контракты этим пакетом не разворачивались.
