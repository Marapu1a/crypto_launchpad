# Независимый GPT review: общий Pons runtime перед production

**Дата:** 14.10.2026. **Проверенный HEAD:** `31c8d52695ad2cb91494bcaa55ab077e58d149af`; база сравнения `e3585b6a14fbdeabbde55452c99c83a934a92a7a`.

**Основание задачи:** `docs/GPT_REVIEW_BRIEF.md`. Это независимое **адресное статическое ревью** релиз-кандидата, а не разрешение устанавливать/активировать его. Прочитаны AGENTS, CURRENT_CONTEXT, ROADMAP, PRODUCT_SPEC, TOKEN_SERVICE_MODEL, PONS_RUNTIME, PONS_RELEASE, PONS_EVENT_SERVICE, PONS_PURCHASE_ACCOUNTING и ключевые файлы Pons runtime, collector, budget, QIANQI scheduler/migration, v2 worker, projections, tests. GitHub-ревизия получена через API, рабочий checkout/production state недоступны: **не запускались unit/contract/SQL/harness, fork, SSH, RPC, QuickNode, live transactions**. Репортируемые PASS и два полных локальных цикла — сведения из документов команды, не перепроверенные мной исполнения. Исторические аудиты и отчёты не использованы как live status.

**Вердикт:** архитектурно движение разумное; **в прочитанном пути не найден доказанный новый способ вывести призы, повторно назначить RNG или безусловно выплатить дважды**. Но до включения единого runtime нужно закрыть несколько конкретных проблем observability/экономии и усилить release gate, а также квалифицировать именно реальный бесплатный RPC на сервере. **Production activation сейчас не рекомендую.** Возвращать платный QuickNode, постоянные block scans и traces не предлагаю: принятое доверие к Pons и текущую финансовую семантику не меняем.

## 1. P2 / подтверждённый кодовый сценарий: QIANQI может так и не перейти в экономный режим при внешнем ожидании Pons

**Код:** [server/adapters/qianqi/pons-service.mjs, строки 4–11](../server/adapters/qianqi/pons-service.mjs), [pons-funding.mjs](../server/adapters/qianqi/pons-funding.mjs), [runtime/scripts/pons-funding-pass.cjs](../server/adapters/qianqi/runtime/scripts/pons-funding-pass.cjs), [runtime/scripts/pons-collector-manual.cjs](../server/adapters/qianqi/runtime/scripts/pons-collector-manual.cjs), [server/shared/pons-service.mjs](../server/shared/pons-service.mjs).

`schedulerObservation` разрешает `idle` только при `result.funding.every(row => row.status === 'empty')`. Однако штатный `inspect` коллектора выдаёт `sweep.status='waiting'`, если `sweepState.waiting`, в том числе для `awaiting-pons-operator` после graduation. `runFundingPass` сохраняет такой статус, не создавая транзакции. В итоге QIANQI без активных покупок/задолженностей может постоянно классифицироваться `unknown`, supervisor не засыпает, а host делает тяжёлый RPC pass через короткий `pollMs`. Это **реальный структурный сценарий**, но фактическая частота и актуальная стадия QIANQI на VPS этим ревью не проверялись.

**Минимальная правка:** различить `waiting external/no ready action` и `blocked/unresolved pending journal / pending RNG / claimable`. Только строго определённое доказуемое внешнее ожидание с известным контрольным сроком должно разрешать редкий control-check (например, существующие 30 минут или отдельный bounded interval); неизвестный funding status и конфликт по nonce — нет. Не объявлять любой `waiting` idle. Сохранить возможность обслужить старые награды/RNG при недоступном Pons. Тест: `sweepState waiting/awaiting-pons-operator` + обе lanes `schedule/empty` + нет pending actions => 1 полный pass, последующие пустые ticks 0 RPC, deadline будит; отдельно `waiting+claimable` и `unknown` никогда не спят. Измерить RPC за час для обеих ветвей на идентичных fixtures.

## 2. P3 / подтверждённая лишняя работа: heartbeat без изменения времени источника переписывает большие снимки на каждом tick

**Код:** [server/shared/pons-runtime.mjs](../server/shared/pons-runtime.mjs), [server/shared/pons-service-loop.mjs](../server/shared/pons-service-loop.mjs), [server/shared/pons-heartbeat.mjs](../server/shared/pons-heartbeat.mjs), [server/adapters/qianqi/pons-public-store.mjs](../server/adapters/qianqi/pons-public-store.mjs).

В `runPonsRuntime` при каждом `service-sleep` вызывается `onSleep`. Loop с default `pollMs=15000` повторяется примерно каждые 15 сек, даже если Python collector обновляет Pons report только раз в 300 сек. `refreshQianqiHeartbeat` каждый раз читает, пересчитывает checksum и **атомарно переписывает весь public JSON**, даже когда `sourceCheckedAt` не изменился. `refreshDrawHeartbeat` аналогично выполняет SQL UPDATE и `service_at=clock_timestamp()` с неизменным значением Pons. Это **не лишний RPC и не прямой финансовый дефект**, но постоянные ненужные I/O, большие rewrite, WAL и backup churn. При большом количестве токенов это уже противоречит цели дешёвого idle.

**Минимальная правка:** если `sourceFingerprint` и `sourceCheckedAt` полностью совпадают с уже сохранёнными, ничего не записывать; при изменении только sourceCheckedAt сохранить неизменными `contractVerifiedAt`, checkpoint, balances, outcome и parent verified hash. В SQL использовать условный UPDATE, в файловом reader — early return без write. Тест: 20 пустых ticks после одного подтверждённого report, snapshot bytes/hash/mtime или DB snapshot/WAL writes не меняются; при реальном увеличении sourceCheckedAt меняется только он, а давность контрактов не «омолаживается». `service-sleep` всё ещё не делает RPC.

## 3. P2 / release-gate coverage gap: read-only inspector проверяет не весь новый Pons-host state

**Код:** [scripts/inspect-pons-runtime.mjs, строки 41–58](../scripts/inspect-pons-runtime.mjs), [server/shared/pons-bootstrap.mjs](../server/shared/pons-bootstrap.mjs), [server/adapters/qianqi/pons-scheduler.mjs](../server/adapters/qianqi/pons-scheduler.mjs), [docs/PONS_RELEASE.md](PONS_RELEASE.md).

QIANQI inspection проверяет `binding.statePath` и `binding.statePath+'.rng'` у **старого** native executor, затем `migrationFile` и public snapshot. При этом новый host **запускает** `entry.stateFile` и отдельное `entry.stateFile+'.rng'`, где будут лежать pending intent, frozen/candidate jobs и новые receipts. `entry.stateFile` может намеренно отличаться от `binding.statePath` — это нормально. Но тогда статус `qualified` **не доказывает**, что новая директория пуста либо содержит ровно ожидаемый новый Pons-journal и что она не противоречит source migration/legacy state. Прочитанный inspector также не сверяет отдельное `binding.statePath+'.scheduler'` старого рабочего контура с готовыми активными/незавершёнными jobs; он блокирует только `migration.ledger.pending` и отдельные `state.pending`. Это не доказанная ошибка оплаты; это **ложноположительная готовность preflight** в сценарии переезда/повторного запуска с оставшимся state.

**Минимальная правка:** до `qualified` проверять совместно identity/paths нового stateFile(+RNG), существующих native planner/child scheduler journals и миграционного snapshot. На первом запуске новый state path должен быть *явно пуст и ещё не активирован* либо иметь верифицированный compatible state. Если существуют legacy active/frozen/prepared operations, требуется явный import/reconciliation, не создание пустого журнала. Проверять runtime bindingHash, nonce latest/pending, on-chain draw/pending/claimable и точный механизм handoff в безопасном read-only режиме. При любой неопределённости — `blocked` с безопасным обобщённым кодом причины. Не читать и не выводить приватные ключи или signed bytes в отчёт. Тесты: новый stateFile с подменённым/старым checksum, живой legacy scheduler job, незавершённая RNG, несовпадающий migration boundary, clean first-time migration — статусы blocked/qualified ожидаемые. Сценарии с реальным ключом/production не запускать.

## 4. P2 / непроверенная полнота источника и масштаб: чёткие условия отказа, не «поправить RPC»

**Код:** [scripts/pons-accounting/accounting.py](../scripts/pons-accounting/accounting.py), [src/tickets/pons-accounting.mjs](../src/tickets/pons-accounting.mjs), [docs/PONS_PURCHASE_ACCOUNTING.md](PONS_PURCHASE_ACCOUNTING.md).

Это преимущественно **принятый продуктовый компромисс, не новая найденная уязвимость**: Pons API — authoritative, `quoteAmount/trader` отличаются от исторического `wallet-net-debit`, старые кредиты grandfathered. Исправления/удаление сделок при полной проверке переводят журнал в review-required; ничего не пересчитывается молча. При неизменном Pons metadata fingerprint полный обход выполняется раз в 6 часов, поэтому скрытые исправления старых строк могут не выявляться до него. По умолчанию ограничение 20 страниц, при большом объёме сделок весь collector становится unavailable. После graduation только `venue=curve`, новый venue — review-required.

**Не менять эту модель молча.** Перед production нужно зафиксировать и протестировать минимум:
- Source failure, missing/corrected trade, page budget, смена stage/venue: **нет** новых admissions/freeze на неполном отчёте, но существующие frozen/rewards всё ещё обслуживаются.
- Старые QIANQI билеты (28, Short consumed 16, Monthly 28 в сохранённом сравнении) остаются и не дублируются при новой базе сумм; для IGW признанные старые attempts/receipts сверяются по actual state, не по опубликованному fixture.
- `lastTradeAt/tradeCount` — оперативные индикаторы изменений Pons, а не proof всех tx; public UI должен сохранять исходный статус/время проверки и не обещать независимую chain finality покупок.
- Если реальная история превысит page budget, рассматривать bounded incremental paging отдельно, с transaction identity и восстановлением, а не просто увеличивать лимиты/допускать частичный batch.

## 5. P1 activation gate / нельзя считать production проверенным по локальным циклам

**Источники:** [docs/PONS_RUNTIME.md](PONS_RUNTIME.md), [docs/PONS_RELEASE.md](PONS_RELEASE.md), [server/shared/rpc-budget.cjs](../server/shared/rpc-budget.cjs), [server/short-runtime/rpc-provider.mjs](../server/short-runtime/rpc-provider.mjs).

Документы корректно фиксируют **локальный** полный QIANQI/v2 цикл (в т.ч. RNG, claims, restart), но production endpoints, actual host config/DB/rights/secret custody и quotas Free RPC не квалифицированы. Персистентный gate считает JSON-RPC requests, **не CU, gas, bandwidth или лимит по методам**. Указанные `1000/hour` — лишь шаблон. Публичные QuickNode-запросы запрещены владельцем, старые службы в актуальном состоянии остановлены.

**Обязательные gates перед разрешением активации (только отдельный owner-approved release):**
1. На сервере offline проверить точные config/profile/chain/token/runtime/roles, содержимое journal+pending и backfill миграции на **свежем** canonical/finalized состоянии; ручные нерешённые операции — `blocked`.
2. Квалифицировать **один выбранный бесплатный** HTTPS RPC по нужным методам/скорости в явных безопасных лимитах; обнаружить фактические 429/timeout, поддерживаемую finalized head и операционную стоимость **двух** проектов. Не обращаться к QuickNode.
3. Реально подтвердить, что все read/send/guards/receipt/RNG contract calls обоих адаптеров проходят один постоянный budget с одним lock/owner и без скрытых retries. Отдельно измерить на стенде cold start, non-idle, idle 1h, exhausted quota, restart/lock crash, single external funding wait. Не выводить account billability из числа requests.
4. Повторить fault/restore на **копиях**: kill до подписания, после durable signed intent, после broadcast, до state save, reorg/missing receipt; сохранить тот же hash/nonce. Отдельные state/keys/credits двух токенов. Ни один старый signer worker не должен стартовать рядом с новым.
5. Пройти сценарий backup/restore с native QIANQI files и PostgreSQL вместе, с read-only сверкой старых наград/покупок, без replay старых транзакций из устаревшего backup; проверить notify/health `RPC_BUDGET_EXHAUSTED`, missing source, missing contract funds/ETH.
6. Убедиться, что Pons-модель выдаёт билеты в том же порядке относительно сохранённого frozen cutoff; не терять права при падении collector, а restart не делает reroll.

## Что проверено, чего не проверял

**Адресно прочитан код:** `scripts/pons-accounting/accounting.py`, `src/tickets/pons-accounting.mjs`, `server/shared/{pons-bootstrap,pons-runtime,pons-service,pons-service-loop,pons-heartbeat,rpc-budget,rpc-gate,rpc-transport}.mjs/cjs`, `server/adapters/qianqi/{pons-scheduler,pons-migration,pons-service,pons-controller-events,pons-publications,pons-funding,pons-projection,pons-public-store}.mjs`, `server/short-runtime/{rpc-provider,projection,draw-projection}.mjs`, `server/shared/draw-worker.mjs`, `scripts/inspect-pons-runtime.mjs`, ряд релевантных tests и доков.

**Не проверялось:** полный repository test suite, offline fixtures и архивы в `.local/`, фактический deployed runtime, содержимое project config и PG/native DB, signer custody, реальный бесплатный RPC, реальная активная позиция QIANQI/IGW, независимость всех косвенных HTTP путей. Подробные данные tests/PASS в `PONS_RUNTIME` оставлены статусом **«из отчётов команды»**.

**Оценка:** два конкретных performance/observability defects (пункты 1–2), один реальный пробел release inspector (3), явные продуктовые/операционные ограничения (4–5). Новых доказанных багов непосредственного расходования призов в адресно прочитанном ядре не нашёл; это **не security certification**.

### Codex: рекомендуемая очередь

**Шаг 1:** добавить адресные unit/SQL tests и исправить `funding waiting → false-active polling` без изменения платы/билетов/приоритета claims. **Шаг 2:** idempotent source heartbeat без ненужных rewrite. **Шаг 3:** усилить read-only инспектор new+legacy journals и явно определить первые/повторные миграции. **Шаг 4:** локальная контрольная точка и только затем отдельный preflight на реальном бесплатном RPC (без QuickNode), с явным разрешением владельца на production activation.

Ни один пункт ревью сам по себе не является разрешением менять боевые контракты, запускать старые службы, оплачивать провайдера или отправлять транзакции. Исправлять маленькими пакетами и после каждого фиксировать exact HEAD, тесты, пределы и evidence.
