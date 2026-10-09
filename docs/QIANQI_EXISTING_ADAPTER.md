# Existing QIANQI adapter

09.10.2026. Реализация для существующих контрактов сети 4663; не шаблон нового
токена. Переключение production разрешено владельцем, ожидание активности не нужно.

## Что реализовано

- `server/adapters/qianqi/runtime`: выбранный граф исходников QIANQI из
  `11a050d995f17c2c810db1fe5c4e7a3ec1190ff3`, включая Short/Monthly, funding,
  claims, RNG, native routes и позднее распознавание. Отдельно закреплены три
  проверенных изменения recognition finality из рабочего checkout. Контрольные
  суммы двух изменённых production-модулей совпали с сервером.
- `UPSTREAM.json` фиксирует происхождение, `ADAPTATIONS.json` — точные изменения.
  Vendor и исходный rh_project не менялись. Конфиги, кошельки, ключи, эксплуатационные
  журналы и release manifests из старого проекта не копировались в репозиторий.
- `run-qianqi-executor.mjs` проверяет исходные конфиги и три существующих журнала,
  сохраняет их пути/формат/configHash и получает отдельную PostgreSQL-блокировку
  signer. Старый process lock также сохраняется. Два исполнителя запрещены.
- Fence повторно проверяется перед отправкой и после сохранения подписанного
  intent. При потере БД отправки прекращаются; intent остаётся для reconciliation.
- Общий API обслуживает `/v1/overview` и `/v1/wallets/:address` по Host → project.
  Он читает **только публичную проекцию PostgreSQL**, без доступа к файлам/ключам
  исполнителя и без проксирования прежнего API.
- Индексатор формирует проекцию из проверенного native snapshot и сохраняет её
  после успешного прохода. Ответы, pagination, late credits и stale semantics
  сохраняются. Подмена токена/configHash, откат head и другая ветка на том же head
  не могут незаметно заменить проекцию.
- Migration010 добавляет неизменяемые для runtime привязки исполнителя и API;
  отдельные права API/jobs/executor и FORCE RLS.

## Честная граница первого переноса

Это перенос исполнения и API в код платформы с общей PostgreSQL-проекцией.
Приватные журналы и canonical index QIANQI остаются в родном файловом формате;
его scanner пока не заменён общим chain reader. Это намеренно позволяет продолжать
старые операции без преобразования подписанных транзакций и даёт совместимый rollback.
Полная унификация хранения/сканирования — последующий этап, не выполненная работа.

Runtime использует прежние параметры QIANQI, включая оба lane и split90/5/5.
Пресет первого нового токена к нему не применяется. Общие роли PostgreSQL по-прежнему
не защищают от компрометации общей роли с возможностью сменить project context.
Signer lock дополняет filesystem ownership; он не позволяет запускать старый
исполнитель с другим statePath/тем же ключом в обход процедуры handoff.

## Проверки

- Unit: Host-изоляция и query validation; сохранность signed intent; потеря fence
  после подписи до broadcast.
- PostgreSQL18: конфликт исполнителей, потеря backend-сессии, binding/RLS/права,
  точное совпадение PostgreSQL overview/wallet со старым renderer, stale/checksum/
  branch, backup/restore. Native private files API не нужны.
- Перенесённые тесты: receipt failures, process locks, late recognition/finality,
  public admission и API. Сквозная локальная сеть4663: завершение обоих frozen
  draws, prove/deliver/settlement/claim и restart без повторной выплаты.
- Это локальные проверки, не подтверждение уже выполненного production handoff.

Команды:

```text
node scripts/check-qianqi-runtime.mjs
node --test tests/unit/qianqi-adapter.test.mjs
node tests/shared/projects.mjs --qianqi-adapter
node scripts/build-qianqi-runtime.mjs
node scripts/test-qianqi-runtime.mjs --contracts
```

Build создаёт исключённые из Git `runtime/artifacts/compiled.json` и
`runtime-manifest.json`. Их включают в release; runtime сверяет SHA256 и не
компилирует Solidity при каждом проходе. Повторный build закреплённого артефакта
требует явного разбора версии, а не молчаливой замены.

## Порядок серверного переключения

1. Сверить исходники и снимки действующего release, зарегистрировать project-bound
   конфиги и проекцию в migration010. Подготовить отдельный общий API с lp_api.
2. Проверить новый API на loopback против старого при одной генерации snapshot.
3. Сделать согласованный backup, остановить прежнего финансового исполнителя,
   проверить снятие его locks, перечитать финальные журналы и on-chain pending.
4. Сохранить прежние systemd unit names/credentials и пути состояния, заменить
   только runtime/entrypoint; это сохраняет совместимость старого backup/monitor.
   Индексатор должен публиковать PostgreSQL-проекцию.
5. Запустить единственного нового исполнителя, проверить первый проход и журнал;
   переключить nginx `/v1/` на общий API после проверки ответов.
6. Сохранить старые release/drop-in/nginx, проверить rollback и непрерывные backups.
   Суточные shadow timers не являются production backup/monitor; их deadline
   не должен отключить защиту работающей платформы.

При rollback сначала остановить нового исполнителя; восстановить старые unit/nginx,
использовать актуальное совместимое состояние. **Не возвращать старый backup поверх
состояния после новых транзакций.** Свежие on-chain операции не откатываются.
