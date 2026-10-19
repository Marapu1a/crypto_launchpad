# Pattern Watcher: публикация и подготовка 19.10.2026

## Выполнено

- Frontend `0488c5e` опубликован на https://pw.qianqi.site, TLS до 17.01.2027,
  автоматическое продление certbot. Desktop/mobile открыты в Chromium, ошибок JS нет.
- Отдельный `pons-market-monitor.service`: /opt/pons-monitor/releases/0488c5e,
  current symlink; порт 4196 только loopback. Без RPC и финансовых ключей.
  Используется отдельный системный пользователь pons-market-monitor.
- SQLite перенесена через backup API, integrity_check=ok. Старый Windows collector
  PID 1060 остановлен после успешной проверки серверного сбора. Последняя локальная
  копия сохранена отдельно, новая серверная история не перезаписывалась.
- `/api/status` подтвердил свежий полный интервал; GET не запускает сбор.
  Wallet API ограничен nginx: 6 запросов/мин на IP + burst 2; остаётся внутренний TTL.
- Ежедневная SQLite backup, хранение 14 снимков: pons-market-backup.timer,
  /var/backups/pons-market-monitor. Скрипт проверяет целостность копии.
- Логотип загружен через обычную форму Pons, IPFS readback совпал.
  [Metadata](../tokens/PatternWatcher/metadata.json),
  [publication](../tokens/PatternWatcher/logo-publication.json).
- Код подготовки установлен отдельно: /opt/crypto-launchpad/releases/pw-0488c5e.
  Изолированный PostgreSQL 18/pw на loopback:5434, database pattern_watcher,
  21 миграция. Существующий cluster main, QIANQI/IGW не мигрировались.
- Приватная конфигурация /etc/crypto-launchpad/pw; encrypted executor/publisher
  успешно расшифрованы на сервере и адреса совпали. Owner key не переносился.
- PostgreSQL dump восстановлен в pw_restorecheck_20261019: 21 миграция.
  Приватная копия БД/конфигурации скачана в пользовательский каталог
  crypto-launchpad-private-backups вне Git. Не публиковать её содержимое.
- Owner console собрана, service pw-owner-console, loopback:4216.
  API сообщает signingEnabled=false, sendEnabled=false. Не опубликована через nginx.
- Read-only проверка production pins/finality/EOA прошла, 28 RPC-вызовов.
  RPC Alchemy, QuickNode не используется. Для PW подготовлен общий бюджет
  10000 запросов/сутки с интервалом 100 ms; это предел запросов, не разрешение
  на оплату провайдера. Runtime PW ещё не активирован.

## Средства и оставшиеся решения

Наблюдение 08:52 UTC: Robinhood Chain 4663, Alchemy,
finalized block 92478763. Owner/project
0x098afA6731239a00CE0aff669aaefD16b7C72114: 0.008055362290600187 ETH.
Executor 0x9083FF89eaa43f6442471A66a917579C7a482D74 и publisher
0x8A9Fa285A82aaDBF3aC7030eC6Ec9edd6a068A11: 0 ETH.

Утверждено владельцем 19.10.2026: запуск до 0.003 ETH, резерв executor 0.001,
publisher 0.0005. Кандидат gasLimit 6500000, fee cap 40000000 wei,
owner floor 0.0005 ETH. Консервативная оценка 9 шагов по cap + Pons fee:
0.00284 ETH. Это потолки, не прогноз расхода. Утверждены общий потолок запуска и резервы; это не разрешение на переводы или запуск сейчас.
`operator.candidate.json` помечен budgetApproved=true, но allowPublicTransactions=false; запуск не подготовлен
в production-журнале и не подписан. Подпись, переводы и активация остаются выключены до отдельной команды владельца.

## Вечером

1. Обновить остатки, finality и цену следующего шага в рамках утверждённого бюджета.
2. Подключить owner signer в приватной сессии; сейчас ownerKeystore=null.
3. Подтверждение владельца на реальный запуск, затем девять шагов с журналом.
4. Только после finalized launch: фактический token runtime hash, curve exclusions,
   holder limits/admission, registration сервисов и включение исполнения.
   До существования токена эти проверки нельзя считать завершёнными.
5. Пополнить служебные кошельки в рамках утверждённых резервов, отдельно от deploy.

Ни токен, ни финансовые службы PW не активированы. Публичных транзакций не было.

## Откат сайта

Остановить pons-market-monitor, сохранить SQLite backup, переключить current на
проверенную версию и запустить службу. Не откатывать БД поверх новых наблюдений.
Nginx pw — отдельный vhost; любые изменения проверять nginx -t перед reload.
Не менять конфиги и процессы других токенов.
