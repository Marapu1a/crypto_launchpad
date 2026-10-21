# PW: запуск через браузерный кошелёк

21.10.2026. Владелец разрешил выпуск PW и подтвердил прежний сценарий IGW:
открыть страницу, последовательно подтвердить шаги своим браузерным кошельком.
Лимиты запуска и обслуживания не меняются. Ключ владельца не переносится.

В PW console добавлен отдельный browserWallet mode. Сервер сохраняет точный
запрос до вызова eth_sendTransaction. Номер транзакции, сеть, calldata, value,
отправитель и предел стоимости проверяются; результат привязывается по хешу.
Закрытие страницы или потеря ответа не запускают повторную отправку.
После отказа пользователя можно явно открыть тот же запрос; после отправки
восстановление выполняется по хешу из истории кошелька. Изменившийся nonce
запрещает повторный вызов кошелька. Сниженные gas/fee допускаются, превышение
показанного максимума не принимается. Существующий server-signer путь сохранён.

Добавлена возможность оператору заменить только полностью неподписанный план:
history пуст, pending и walletPending отсутствуют, stage prepared. Старые input,
steps и scope остаются в superseded; identity строки БД не меняется. Публичный
HTTP endpoint не принимает произвольные метаданные или calldata.

Описание сохранено из launch-passport.json; по просьбе владельца в метаданные
перед первой подписью добавляется https://t.me/qianqi_hub_bot.

Проверено локально:

- `tests/holders/pw-launch.mjs`: PASS, отдельная EVM fork и PostgreSQL,
  четыре браузерных шага и пять существующих signed-raw шагов, реальный
  Pons launch на fork, recovery, finality, handoff. 202 внешних read-only RPC,
  публичных отправок нет. Отчёт `.local/test-results/pw-launch-2026-10-21T19-51-24-957Z/report.json`.
- `tests/studio/pw-browser-wallet.mjs`: PASS, отказ, reload, recovery по хешу
  без повторной подписи (моделируемый coordinator, без внешнего RPC).
- `tests/studio/pw-owner.mjs`: PASS, прежние девять шагов, Origin/Host,
  выключенный signer, desktop/mobile.
- Unit PW console/browser wallet и соседние owner wallet/production: PASS.
- Vite build: PASS. Контракты, их настройки и build hash не изменялись.

Реальный выпуск требует подтверждений владельца в браузере. Проверки fork
не являются свидетельством публичного выпуска PW.

## Сервер и страница владельца

21.10.2026, 22:56 МСК: новый неподписанный план прошёл live preflight.
Release `/opt/crypto-launchpad/releases/pw-browser-af58d7e-20261021`, код `af58d7e`.
Manifest: `c18f6491cb31e7e922f0670abf23aada6c824c1a63d30837ab410c394e2a33f7`.
Переключена только PW console через drop-in `97-browser-20261021.conf`.
Runtime QIANQI/IGW и публичный монитор этим пакетом не переключались.

Backup `/root/pw-browser-20261021/pattern_watcher.dump`, SHA-256
`d27a7d44ce465030de1d6e14f36f33d0745fede449fed6d780d9f11a4e93ae83`.
Прежний план отдельно сохранён в
`/var/lib/crypto-launchpad/pons-preflight/pw-before-telegram-20261021.json`.
После добавления Telegram ожидаемый адрес токена изменился:
`0xe0c6b2040624dde42c3ce55cfbf818d8b79035b7` — пока прогноз, не выпущенный контракт.

Конфиг `operator.browser-20261021.json`: browserWallet=true,
allowPublicTransactions=true по разрешению владельца, ownerKeystore отсутствует.
Профиль и финансовые пределы сохранены; service executionEnabled=false.
Vault quote: nonce 42, gas limit 2199742, max fee 40572000 wei,
верхняя стоимость 0.000089247932424 ETH. Общий RPC ledger 140/2000,
защищённый резерв не менялся. Результат:
`/var/lib/crypto-launchpad/pons-preflight/pw-browser-ready-20261021.json`.

SSH forward: http://127.0.0.1:4216. Проверка реальной страницы Playwright PASS:
browser wallet включён, описание/Telegram присутствуют, state prepared,
history=0. Кнопки подписи проверкой не нажимались. Далее подписи владельца.
Автоматическое открытие ссылки в обычном браузере заблокировано политикой среды;
ссылка доступна для ручного открытия.

Откат интерфейса: убрать только drop-in 97 и перезапустить PW console.
Не откатывать БД, RPC ledger или уже отправленные транзакции.
