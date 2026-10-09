# Подготовка ограниченной серверной репетиции

09.10.2026; основа `ada143f`. Пакет реализован и проверен локально.
На сервер ничего не установлено, QIANQI не переключён, подписи/отправки отсутствуют.
Исходный план: [SHARED_SERVER_PLAN](SHARED_SERVER_PLAN.md).

## Реализация

- Migration009 добавляет immutable `qianqi_live_bodies` с project/module scope и
  FORCE RLS. Полное состояние без `provenance.head` сохраняется по digest;
  каждый head хранит компактную ссылку, исходный полный digest и observation.
  Body и head записываются одной транзакцией. Read проверяет оба checksum.
  Старые full-payload строки читаются как раньше, не переписываются.
- `shadow-storage.mjs` сохраняет gzip-объекты по SHA256 и manifests со списком
  исходных ответов каждого цикла. Повторный объект не пишется; повреждение
  существующего объекта останавливает runner. `readCapturedCycle` восстанавливает
  точные ответы. Автоматической очистки evidence нет: достигли бюджета — остановились.
- `shadow-runner.mjs` держит отдельный PostgreSQL session lock на project/module
  на всё время работы, включая captures. Повторный процесс не запускается.
  После kill lock освобождается соединением; исходный deadline остаётся на диске.
- CLI требует абсолютный отдельный `QIANQI_STATE_DIR`, явные project/module,
  `SHARED_JOBS_URL` и `PONS_ARCHIVE_RPC`. Запись относительно cwd удалена.
  `qianqi-import-shadow.mjs` принимает абсолютный путь manifest с тремя каталогами
  публичного evidence; относительные записи разрешаются от manifest, не cwd.
  Импорт по-прежнему перепроверяет evidence и binding уже созданного shadow module.
  CLI не создаёт проекты и не принимает один сохранённый success-report за доказательство.

## Лимиты

| Параметр | Значение по умолчанию |
| --- | --- |
| QIANQI_MAX_BYTES | 3 GiB: state directory + размер текущей БД |
| QIANQI_MIN_FREE_BYTES | 10 GiB свободного места на разделе state directory |
| QIANQI_CYCLE_BYTES | 16 MiB новых файлов за цикл |
| QIANQI_DURATION_SECONDS | 86400, от первой инициализации state directory |
| QIANQI_INTERVAL_SECONDS | 60 после завершения предыдущего цикла |

`rehearsal.json` привязывает каталог к project/module и конфигурации. Изменение
лимитов в существующем каталоге отвергается, перезапуск не продлевает срок.
Для новой согласованной репетиции нужен новый каталог; предыдущий сохранить.
Каталог должен быть новым/пустым или уже инициализированным этим runner.
Symlink и посторонние типы файлов в его дереве не допускаются.

Размер файлов и БД проверяется до цикла; свободный диск — при чтениях/записи,
размер БД и диск — также перед транзакцией checkpoint и перед commit. Ошибка
последней проверки откатывает body/head. Это прикладные защитные проверки,
**не файловая квота**: WAL, общекластерные файлы и параллельная внешняя запись
не входят в `pg_database_size`. Для серверной репетиции state и PGDATA должны
находиться на проверяемом корневом разделе; отдельный tablespace/WAL mount требует
дополнительного мониторинга. Рост WAL проверяется оператором отдельно.

Exit78 означает остановку по лимиту/deadline, занятому lock, нарушению хранения
или reorg halt. Unit не перезапускает такой exit автоматически. Обычная ошибка
наблюдения даёт NOT_ADVANCED с фиксированным сообщением без URL/credentials;
watch повторяет попытку до deadline. Последний успешный DB cursor сохраняется.
`latest.json` — диагностический статус, не источник истины для курсора.
После аварии могут остаться объекты без завершённого manifest; они сохраняются,
занимают бюджет и повторно используются по checksum. Транзакционный курсор в БД
определяет, какой интервал надо повторить.

## Шаблоны и порядок будущего включения

Шаблоны [ops/shadow](../ops/shadow/crypto-launchpad-shadow.service): отдельный
`launchpad-shadow`, read-only release, writable только `/var/lib/crypto-launchpad/shadow`,
отсутствие capabilities, скрытые каталоги QIANQI, общий Node slice
MemoryHigh768M/MemoryMax1G/CPUQuota50%. PostgreSQL в этот slice не входит.
Node22 по `/usr/bin/node`; shutdown timeout330s учитывает бюджет сетевого цикла.

Это файлы для review, не установщик. Следующий серверный пакет:

1. Согласованная установка PostgreSQL18, отдельная БД `launchpad_shadow`, bootstrap
   ролей из [baseline](SHARED_BACKEND_BASELINE.md), migrations001–009. Только local
   socket/loopback и отдельные runtime credentials; admin URL не отдавать worker.
2. Отдельный OS user и каталоги; immutable release без `.local`, ключей и конфигов
   QIANQI. `shadow.env` из [примера](../ops/shadow/shadow.env.example), права0640,
   root:launchpad-shadow. Подставить реальные UUID, пароль и RPC локально на хосте.
   Bootstrap public archive отдельным read-only каталогом; формат
   [archive.example.json](../ops/shadow/archive.example.json).
3. Создать shadow project/module с проверенным adapter/config hash (как в
   [historical import](QIANQI_POSTGRES_IMPORT.md)), выполнить CLI импорта с manifest.
   Проверить head/digest и доступ к архиву. Сохранить dump и проверить восстановление
   в отдельную БД прежде, чем включать длительное наблюдение.
4. Выполнить один цикл с той же env-конфигурацией, затем разрешённый `--watch`.
   Unit/slice установить root-owned0644; сначала `systemd-analyze verify` на целевой
   системе. Системные users, фактические пути и права требуют проверки на хосте.
   Nginx, DNS, публичные порты и финансовый executor для этой репетиции не нужны.
5. Наблюдать 24 часа или до защитной остановки: head/lag, новые события, ошибки,
   RSS/CPU, размер state/DB/WAL, свободный диск, доступность прежнего QIANQI API.
   Все runtime receipts/captures хранить в новом state; старые архивы не заменять.

Прямые команды CLI после предоставления env (не запускались на сервере):

```text
node /opt/crypto-launchpad/current/scripts/qianqi-import-shadow.mjs
node /opt/crypto-launchpad/current/scripts/qianqi-live-worker.mjs
node /opt/crypto-launchpad/current/scripts/qianqi-live-worker.mjs --watch
```

Восстановление репетиции требует **и dump БД, и state/bootstrap evidence**, плюс
идентифицируемого commit кода. Deadline/state marker сохранять при restore.
Новый off-server backup остаётся частью серверного пакета. Откат: остановить только
новый unit и сохранить его данные. Старый код до migration009 не читает компактные
строки: нельзя просто переключить current на `ada143f` при уже записанных новых heads.
Использовать совместимый release или отдельную БД из pre-migration backup.

## Проверки и доказательства

PostgreSQL18.6 Windows binaries скачаны с [официальной страницы EDB](https://www.enterprisedb.com/download-postgresql-binaries)
(fileid1260609), распакованы в `.local/tools`, без установки службы.
SHA256 скачанного архива:
`e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2`.
Это локальный fingerprint, не сверка с отдельно опубликованной подписью поставщика.

- PG18: migrations001–009, HTTP/RLS/reader и verified QIANQI import прошли.
  Первый общий прогон остановился на синтаксисе нового теста после 16 PASS;
  исправлен тест, продолжение на сохранённой изолированной БД: 11 PASS,
  включая compact/legacy read, rollback, concurrent runner, body dedup,
  restart, reorg и реальный dump/restore. Это не замаскировано под один полный PASS.
- Дополнительно 2 PASS на той же PG18: переносимый import CLI из другого cwd
  и реальный kill процесса с восстановлением lock/deadline. Новые сценарии
  включены в `tests/shared/projects.mjs --qianqi-live` для следующих прогонов.
- PostgreSQL17.2: 10 baseline/HTTP/reader/restore PASS с migration009.
- Storage unit4 и соседние live8 PASS. Offline replay сжатых captures PASS.
- systemd syntax проверен локально в WSL Ubuntu24.04 на копиях с ExecStart=/bin/true:
  в WSL нет `/usr/bin/node`. Это проверка директив, **не запуск реального unit**;
  целевая Ubuntu26 и её runtime ещё не проверены.

Измерения на historical head84271425:
133115 bytes полного payload →224 bytes ссылки head +2300 bytes observation;
body133012 bytes хранится один раз при неизменной истории. Это размер JSON,
не физический размер PostgreSQL/WAL. Синтетический следующий пустой блок создал
ещё один head с прежним body; исходный snapshot не удаляется.
146 исходных RPC/API records занимали907157 bytes за цикл; два одинаковых цикла
в новом хранилище —277939 bytes всего,136 уникальных gzip objects. При новых
данных доля повторов меняется, суточную экономию это не доказывает.

Артефакты (локальные, не секретные production-журналы):

- `.local/test-results/shared-2026-10-09T17-04-59-581Z/report.json` — первые16 PASS и причина остановки.
- В том же каталоге `rehearsal-recheck-1791565768696.json` и `runtime-check-1791565863392.json` — завершённые проверки PG18.
- `.local/test-results/shared-2026-10-09T17-09-18-030Z/report.json` — PG17.
- `.local/test-results/storage-replay-CV3ab6/report.json` — compressed evidence replay.

Ограничения остаются: full in-memory replay; одно body на каждое изменение истории;
общие DB roles не защищают от компрометации их credentials; нет полноценной серверной
многопроектной нагрузки, systemd runtime/production restore, публичного API parity
или financial handoff. Следующий пакет — изолированная серверная репетиция по плану,
с собственным backup и измерением влияния на QIANQI.
