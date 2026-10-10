# Постоянное обслуживание нового Short

10.10.2026, пакет после `c29370d`. Служебный runner для новых production-candidate-v1
проектов. Он использует прежний финансовый worker и его PostgreSQL lease/journal.
QIANQI adapter, текущие службы и production БД не изменяются этим пакетом.

## Запуск и допуск

`npm run start:short -- <absolute-config-path>` запускает процесс до SIGTERM/SIGINT.
Шаблон — `ops/short-runtime/runtime.example.json`: пустой реестр, публичные
отправки выключены. `ops/short-runtime/crypto-launchpad-short.service` — заготовка
Linux unit, пока не установленная на VPS. Отдельные OS user, release path и state
directory сохраняют независимость от QIANQI.

Конфигурация содержит mode, intervalMs, concurrency, rpcFile, databaseFile,
healthFile и projects. Для rehearsal дополнительно требуется точный instanceId.
Для production с активными проектами требуется явное allowPublicTransactions:true.
Это операторский переключатель, а не разрешение владельца на запуск.

Каждая запись projects:

```json
{
  "projectId": "UUID проекта",
  "moduleId": "UUID модуля",
  "policyHash": "SHA256 зарегистрированной policy, 64 hex",
  "enabled": false,
  "executor": {"keyFile": "/absolute/encrypted.json", "passwordFile": "/absolute/private-password"},
  "publisher": {"keyFile": "/absolute/other-encrypted.json", "passwordFile": "/absolute/other-private-password"}
}
```

На старте проверяются роль lp_executor без superuser/bypassrls, запись модуля,
policy hash в реестре и БД, checksum policy, отдельные адреса ключей. Используется
существующий encrypted-keystore loader. RPC/DB/password файлы должны быть
абсолютными обычными файлами, без symlink, на Linux без доступа group/other.
Windows ACL остаются обязанностью владельца каталога. Закрытые ключи не пишутся
в health/config/journal. Ошибка ключа блокирует только его проект; исправление
config/ключей применяется после перезапуска процесса.

Перед каждым pass снова проверяются сеть/instance и закреплённая policy.
Далее прежний worker проверяет on-chain bindings, finalized admission и бюджет
каждой отправки. Контракты, RNG, билеты и журналы проектов остаются раздельными.
При штатной остановке процесс дожидается текущих passes. Принудительная остановка
восстанавливается из durable operation/raw/hash прежнего sender, без нового nonce.
Второй экземпляр процесса не обходит PostgreSQL sender lease.

## Экономия чтения и ограничение ресурсов

До восьми явно перечисленных проектов, не более двух одновременно. В пределах
одного прохода общий provider объединяет совпадающие запросы полных исторических
блоков и raw receipts, возвращая каждому проекту отдельную копию. Кэш ограничен
2048 записями/16MiB; miss/error/null не закрепляются. Между проходами он очищается.
Latest/finalized, проверки канонической ветки, eth_call и financial receipt reads
остаются свежими. Ошибка проекта не отменяет работу соседнего.

Это экономия повторных RPC-запросов внутри нового Short runner, **не** подключение
к постоянному reader QIANQI. Общая durable лента блоков существующей платформы
пока не используется этим runner; evidence/cursors сохраняются отдельно в PG
журнале каждого проекта. Объединение reader между обоими runtime — оставшаяся
оптимизация, не причина задерживать первый токен.

RPC transport timeout15s; искусственного Promise.race над финансовым pass нет.
Большой catchup может занимать несколько минут: максимальный возраст health
нужно выбирать по фактической длительности pass, а не интервалу пустого цикла.

## Наблюдение и восстановление

Health JSON атомарно заменяется после прохода: projectId, status/reason, длительность,
балансы газа обеих ролей, предупреждения, завершение и статистика общего чтения.
Консоль получает только изменения статусов, без текстов RPC exceptions/секретов.
На Windows временная блокировка при rename допускает до пяти коротких повторов
замены health-файла. Финансовый pass при этом повторно не запускается. Неустранимая
ошибка сохранения health завершает процесс с указанием этапа; DB journal сохраняется.

```sh
node ops/short-runtime/health.mjs /var/lib/crypto-launchpad/short/health.json 300000
```

Exit1 означает недоступный/устаревший health, blocked/busy, нехватку native,
проблему gas caps, посторонний nonce, clock drift, недоступные finality/beacon.
Обычные ожидания условий или подтверждения receipt не
считаются сбоем. Этот checker пока не подключён к Telegram/внешнему watchdog:
подключение нужно сделать при установке служб. Сам процесс автоматически
не покупает ETH и не конвертирует USDG на обслуживание.

`ops/short-runtime/backup.sh` — заготовка root backup: останавливает только новую
Short-службу, снимает pg_dump общей БД launchpad_shadow и архив каталога short
с encrypted keys, сохраняет config/release/checksums, затем возвращает службу.
COMPLETE создаётся только после успеха. Пароли и RPC/DB credentials должны
храниться отдельно в short-secrets; их нет в архиве. Пароли нужны для восстановления
и требуют отдельной защищённой копии. Существующие backup scripts не менялись.

Linux unit и backup script ещё не запускались на сервере. Перед установкой:
проверить пользователя/пути/DB-доступ, release checksum, encrypted keys и отдельную
копию паролей; восстановить backup в отдельную БД и сверить актуальные nonce и
финализированную историю. Старый backup не даёт разрешения переписать новую
production БД или сбросить worker journal. Первое восстановление — без отправок.

## Проверка и оставшиеся шаги

Unit tests: дедупликация/копирование/границы кэша, свежие guards, изоляция ошибок,
health/gas, завершение текущей операции при stop, явная активация и instance.
Соседний тест проверяет реальные encrypted keystores и неверный password/address.
`tests/contracts/production-worker-cycle.mjs` проверяет два полных финансовых
цикла, DB-session loss, late ticket и повторную загрузку runtime. Дополнительный
child-process тест открывает настоящие encrypted keys, читает PG policy, публикует
health, перезапускается без отката цепочки/БД и не повторяет выплаты.

Пределы: цепочка4663 и Pons здесь моделируются; BLS vectors исторические.
Сам child-process проверяется после settle, на пути без новых выплат; полный
финансовый цикл проверяется через ту же функцию worker в родительском процессе.
На Windows child.kill — принудительная остановка; graceful drain отдельно unit-tested.
Операции VPS, Telegram, Linux backup/restore и настоящий кошелёк этим тестом не доказаны.

Итог: 8 сквозных сценариев PASS, 16 unit/соседних проверок PASS, health CLI PASS,
backup.sh syntax PASS. Финальный отчёт:
`.local/test-results/production-worker-2026-10-10T16-00-49-803Z/report.json`.
Все sourceHashes сверены с итоговыми файлами. Неудачные прогоны15-48-11-406Z
(тест ожидал cache hit без нового блока) и15-52-34-372Z (health rename на Windows)
сохранены. Подробности — `.local/notes/short-runtime-2026-10-10.md`.

Далее: API/страница токена на поддомене, соединение нового owner UI с подготовленным
runtime, установка служб и мониторинга, явные боевые timing/gas параметры и финальный
проход через расширение владельца. Первый public token остаётся отдельным запуском.
