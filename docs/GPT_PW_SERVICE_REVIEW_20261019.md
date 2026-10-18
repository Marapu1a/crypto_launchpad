# Независимый аудит готовности PW — 19 октября 2026

**Проверенный исходный HEAD:** `8707841a91b425997d2ff66025835364bd7aba77`; commit created **2026-10-18 22:34:39 UTC** (19.10, 01:34 МСК). **База:** `2b5d3d191cef969ed6c2e5a3107227b714273fdd`. Диапазон: `2b5d3d..8707841`. На момент проверки нового коммита реализации поверх `8707841` не было. Основание: [актуальное обращение](GPT_REVIEW_BRIEF.md), [предыдущее ревью](GPT_INTERIM_REVIEW_20261018.md).

**Тип работы:** независимое **выборочное статическое** code review через GitHub. Ни одного публичного RPC, Pons API, SSH, базы production, подписания, отправки, локального EVM/PG-теста или full suite **я не запускал**. `.local`-артефакты и пользовательские конфиги не просматривал. Следовательно, PASS из `PW_LOCAL_REHEARSAL`/`PW_SERVICE`/`PW_OPERATOR` — **результаты, заявленные командой**, а не заново выполненное мной подтверждение. Нельзя трактовать это ревью как формальную сертификацию Solidity.

## 1. Итог и граница перехода к следующему пакету

**Owner UI и финальную подготовку запуска — продолжать можно. Реальные ETH, подпись PW token launch и активацию production — пока не разрешать.**

В сравнении с прошлым этапом код **существенно продвинулся**. Уже есть отдельная PW-схема `vault / monthly short / holder splitter / collector`, 30-дневные циклы и ETH raw decimals, собственный launch coordinator с зафиксированными подписанными байтами, managed holder vault с накоплением долга и permissionless оплатой исходному получателю, отдельный оператор публикаций, ограниченная сверка, observer/importer подтверждённых receipts и обслуживание Pons через общий host. Сервисные ETH-платежи, сайт holder-кабинета и owner signing UI **не реализованы** и не входят в этот пакет. Существующие QIANQI/IGW не мигрированы/не изменены.

**Подтверждённых по коду новых способов произвольно забрать holder ETH, reroll после зафиксированного RNG или двойной выплаты одних и тех же entitlement я в просмотренных критических функциях не нашёл.** Но остаётся несколько недостаточно огороженных **операционных** границ. Среди них — конкретное отсутствие общего бюджетирования RPC у CLI-оператора и риск молчаливо продвинуть курсор автоимпорта без ожидаемых финансовых событий. Оба исправляются точечно, без переписывания контрактов или смены продуктовых правил.

Деньги блокируют: (a) реальные роли/тикер/эксклюзивные адреса/газ и резерв, (b) production подтверждение выбранного токена и всех контрактов на chain4663, (c) прогоны restore/unknown/canonical branch на точном final profile, (d) операторская процедура событий, прошедших **мимо** своего writer, (e) независимая проверка финального bytecode/custody и approval владельца. Локальный тест на fork — не аналог запуска.

## 2. Проверка закрытия прошлого ревью по коду

| Прежняя находка | Что теперь есть в коде | Вывод |
|---|---|---|
| **F1, поддельный funding append** | [`server/shared/holder-preparation.mjs`](../server/shared/holder-preparation.mjs): общий `appendEvent` для observed `fee.received / holder.deposited` требует закрытый callback `verifyObserved`; [`importHolderFunding`](../server/shared/holder-preparation.mjs) делает `observeHolderFunding`, затем под `FOR UPDATE` перепроверяет fundingPolicy, finalized высоту и canonical block hash. Событие `snapshot.admitted` и `round.finalized` также закрыто на trusted path | **Закрыто на уровне публичного JavaScript API.** `lp_jobs`/SQL admin всё ещё доверенный субъект: checksum не цифровая подпись и не oracle |
| **F2, generic v4 launcher вместо PW split** | [`server/owner-launch/pw-coordinator.mjs`](../server/owner-launch/pw-coordinator.mjs) использует отдельные `ManagedNativeHolderPayoutVault`, `PwNativeShortProgram`, `NativeHolderFeeSplitter`, `NativeHolderCollector`, девять фиксированных шагов; [`src/worker/pw-policy.mjs`](../src/worker/pw-policy.mjs) сверяет PW bindings и bps 6000/2000/2000 | **Для PW появился отдельный путь.** Не превращать generic ETH owner-flow в «PW» через имя/замену label; после создания оператор обязан пройти отдельные holder/service handoffs |
| **F3, прямой ETH как торговая fee** | [`contracts/holders/NativeHolderCollector.sol`](../contracts/holders/NativeHolderCollector.sol): `forwardableFees` растёт только от callback закреплённого escrow **во время** `collect()`; `forward()` берёт только этот счётчик, unsolicited/forced ETH остаются в `quarantined` | **Прямое смешение collector balance с fee counter устранено.** Не доказан каждый исходный торговый swap внутри Pons escrow — явно принятая внешняя граница доверия |
| **F4, reconnect/reconcile** | Holder funding importer повторно сверяет source identity; [`server/shared/holder-execution.mjs`](../server/shared/holder-execution.mjs) добавил постраничный `resumeHolderReconciliation` с fingerprint, canonical checkpoint, итоговыми `received/allocated/paid/pending` и restart | **Заметно улучшено.** Сверка `progress` не должна трактоваться как `reconciled`; каноничность доверенному RPC не равна независимой криптографической finality |
| **F5, растущий JSONB** | Датированные [замеры](PW_INTERIM_FIXES_20261018.md) и [gas benchmark](HOLDER_GAS_BENCHMARK.md). Текущий `append` делает full replay, что допустимо для малой базы; reconciliation порциями не тащит весь RPC журнал за раз | **Достаточно для текущего масштаба**, не повод сейчас строить новый event-sourcing сервис |

**Отдельно:** `NativeHolderVault` как базовый накопительный контракт в дереве остался, но новая PW deployment-последовательность использует `ManagedNativeHolderPayoutVault` с `openRound / append / seal / consolidate / pay`. Старое замечание «в PW vault вообще нет выплат» **устарело**. Главное теперь — не допустить создания/привязки базового nonredeemable vault вместо managed по неверному профилю. В проверенном PW coordinator выбран managed artifact.

## 3. Новые findings по приоритету

### P1 / operational & cost: отдельный `pw-operator` не наследует RPC gate и запрет QuickNode

**Место:** [`scripts/pw-operator.mjs`, строки 20–26](../scripts/pw-operator.mjs), рядом [`server/shared/pons-runtime.mjs`](../server/shared/pons-runtime.mjs) и [`server/short-runtime/rpc-provider.mjs`](../server/short-runtime/rpc-provider.mjs).

**Проверенное поведение кода:** CLI читает `config.rpcFile`, создаёт простой `FetchRequest` и `new JsonRpcProvider(rpc, undefined, { cacheTimeout:-1, batchMaxCount:1 })`. В **этом** пути нет `allowedRpcHosts`, `quicknode/quiknode` denylist, `persistentRpcGate`, общего файла `rpcBudget` или явного лимитера методов/запросов. В отличие от него `runPonsRuntime` использует `runtimeProvider(...,{gate})` с host allowlist и персистентным счётчиком. Команды holder `snapshot/admit/reconcile/scan` могут делать сотни/тысячи RPC запросов отдельной серией; `maxRpcCalls` ограничивает **одну операцию admission**, но не общий account/hour и не стоимость всех команд. Указание в документации «только бесплатный RPC» сейчас **не является принудительным техническим ограничением CLI**.

**Реальный сценарий:** оператор случайно положил QuickNode или иной платный URL в приватный RPC file, либо запустил несколько `holder-reconcile` подряд на бесплатном тарифе. Код дойдёт до сетевого вызова, несмотря на принятое правило «не обращаться к QuickNode, даже для диагностики». Финансовая потеря здесь — **операционные расходы/лимиты/недоступность**, а не доказанный эксплойт vault. Это можно воспроизвести с fake HTTP provider без обращения к настоящим платным хостам.

**Минимальное исправление:** централизовать транспорт policy: **та же host allowlist + denylist QuickNode**, общий persistent per-account budget и pacing, что у Pons-host; отдельная настройка бюджета для **operator-операций** должна считать расход из того же файла/аккаунта, а не сбрасывать счётчик. CLI fail closed до любого network I/O при запрещённом hostname или отсутствующем/повреждённом бюджетном файле; принудительно отключить redirects и неограниченные внутренние retries. Вывести в `quote/preflight` примерное и фактическое число запросов и budget remaining, без секрета RPC URL. **Не** вводить платный RPC или вечный блок-скан.

**Тесты:** запрет URL `quicknode/quiknode` **до HTTP**, персистентный quota exhaustion после restart, rate-limited HTTP 429, одновременный host+CLI, paged reconciliation на 500/5000 адресах с общим счётчиком, никаких секретов в errors.

### P2 / accounting assurance: автоимпорт PW сдвигает курсор и при нуле ожидаемых логов

**Место:** [`server/shared/pw-service.mjs`, строки 23–42](../server/shared/pw-service.mjs).

**Точное кодовое поведение:** `syncPwHolderFunding` берёт 20 записей `state.history`, для успешного `collector.forward` или `splitter.deliver` читает receipt и проверяет status/blockHash/height. Затем обходит `receipt.logs` и вызывает `importHolderFunding` **для тех** логов, где совпали роль/emitter и `topics[0]` равен `Revenue` или `Deposited`. После любого такого обхода — **даже если совпавших логов не найдено ни одного** — сохраняет `holderFundingCursor=cursor+1`.

**Риск:** при несовместимости новой сборки, неожиданной форме receipt, stale/неполном ответе доверенного RPC или непредусмотренном contract route наша БД признает эту историю обработанной, хотя обязательное для `collector.forward` событие `Revenue` (а для `splitter.deliver(0)` — `Deposited`) не было импортировано. Повторный проход уже пропустит запись. У штатной pinned сборки успешный `collector.forward` должен эмитить Revenue; **отсутствие такого события — аномалия, а не разрешение молча двигать курсор**. Для `splitter.deliver(1/2)` отсутствие `Deposited` нормально — их результат не для holder vault. В собственном журнале `receiptStatus` записан после canonical/finalized проверки, так что это **защитный gap при аномальном evidence**, а не подтверждение существующей потери денег на live.

**Минимальная правка:** парсить calldata/action или запись intent, классифицировать ожидание событий:
- `collector.forward`: ровно один (или строго предопределённый) `Revenue` нового splitter, с pinned source/amount, cumulative continuity; если нет — **block cursor + incident**;
- `splitter.deliver(0)`: обязательная парная `Delivered(holder lane)+Deposited` из vault с совпадающими amount/recipient; отсутствие/неоднозначность — **block**, а не пропуск;
- `splitter.deliver(1/2)`: отсутствие `Deposited` допустимо, но receipt и lane/action обязаны совпадать;
- другие успешные journal actions — курсор может продвигаться как no-op.
  
Существующий `importHolderFunding` проверяет bindings/пару в собственном on-demand path; переиспользовать его вместо второй системы proof. Сначала импорт, потом cursor, оставив идемпотентность при crash между ними.

**Тесты:** успешный `collector.forward` с отсутствующим `Revenue`, `splitter.deliver(0)` без `Deposited` или с неправильной суммой, `deliver(1)` без deposit, повтор после crash перед cursor COMMIT, RPC недоступен на N-й записи пачки — ни одна необходимая сумма не теряется; нет дублей.

### P2 / liveness & runbook: permissionless funding/claims могут пройти мимо журнала daemon

**Места:** [`contracts/holders/NativeHolderFeeSplitter.sol`](../contracts/holders/NativeHolderFeeSplitter.sol), [`server/shared/pw-service.mjs`, строки 23–49](../server/shared/pw-service.mjs), [`docs/PW_SERVICE.md`](PW_SERVICE.md), [`server/shared/holder-execution.mjs`, строки 170–205](../server/shared/holder-execution.mjs).

**Сценарий:** `NativeHolderFeeSplitter.deliver(lane)` вызывается **любой** стороной и всегда переводит по фиксированному адресу. Это полезно и не позволяет забрать награду на чужой кошелёк. Но автоимпорт `syncPwHolderFunding` просматривает **только** `state.history` собственного `runDrawSender`. Если третье лицо доставило holders allocation `deliver(0)`, в PW sender journal этого вызова нет. Далее новая `Revenue` поднимет split cumulative и holder `Deposited.totalReceived`; без импорта предыдущего внешнего deposit строгий счётчик `replayHolderProgram` может законно остановить последующий импорт. Даже при отсутствии новой торговли фонды onchain уже изменены, а event-idle сервис не обязан проснуться: Pons fingerprint не отражает permissionless вызовы.

**Статус:** это **известная и честно указанная в `PW_SERVICE` граница** (`holder-funding` on demand, внешние receipts оператором, новая публикация после подтверждения). Не описывать как «средства исчезают»: onchain holder vault уже получил их. Но если оставить это без операционного procedure, можно получить **невидимое для сайта поступление или надолго застопорившееся обслуживание**.

**Минимальный переход к production:** явный операторский `recover-external-funding`: при mismatch cumulative или несоответствии баланса/credit показать `holder-funding-evidence-missing` с диапазоном/типом, разрешить ограниченный lookup известного адреса и высоты **по запросу**, валидировать/импортировать receipts по порядку. Перед первым holder round — обязательный funding reconciliation, не только `cursor caught up` собственного writer. Прописать ответственного и алерт; не вводить постоянный полностраничный Pons/pool scanner и не прятать частичную сверку под статусом healthy.

**Тесты:** чужой вызов `splitter.deliver(0)` между собственными two Revenue; короткий сбой; повтор импорта внешнего tx; после восстановления полный cumulative holderDelivered, дальнейший draw работает, retry никогда не делает повторный перевод. Для `pay` из произвольного кошелька используется отдельный bounded `Paid` scanner; следить, что его cursor=«догнали finalized» перед признанием общего `reconciled`.

### P3 / publication & UX: публичное состояние PW не получает heartbeat при `service-sleep`

**Место:** [`server/shared/pons-bootstrap.mjs`, PW branch](../server/shared/pons-bootstrap.mjs), [`server/shared/pons-runtime.mjs`, heartbeat loop](../server/shared/pons-runtime.mjs), [`server/shared/pw-public.mjs`](../server/shared/pw-public.mjs).

PW branch регистрирует `publish`, но **не** `onSleep`; `runPonsRuntime` вызывает `onSleep` только если callback предоставлен. Следовательно, `pw-public.json` `checkedAt` обновляется при реальном worker-pass и не изменяется при долгом доказанном idle. Это **не ошибка финансового баланса** и не нужно «освежать» `contractVerifiedAt` без RPC. Но если будущий сайт трактует `checkedAt` как единственный показатель «свежести», он покажет ложное `stale` через часы idle или, наоборот, разработчик может ошибочно продлевать verified time без проверок.

**Решение:** для будущего публичного слоя различать `contractVerifiedAt` и `ponsSourceCheckedAt`, `eventIdle/awaitingActivity`. Разрешить **локальный** heartbeat только с тем же fingerprint и текущим sourceCheckedAt, не переписывать большие снимки и не объявлять новые контрактные проверки. Отсутствие активности — не последний RPC. Пока `pw-public` — лишь технический view и holder UI ещё нет, можно отложить до его реализации, но не допустить некорректного статуса при запуске.

**Тест:** многодневный idle с неизменным trade report, регулярный новый Pons heartbeat, 0 RPC во сне, честный lastContractVerifiedAt; source stale/invalid → видимый `unavailable`, а не свежие деньги.

## 4. Что специально НЕ считаю багами

- **Долг/пыль:** `ManagedNativeHolderPayoutVault` позволяет `consolidate(wallet, periods)` и `pay(wallet, periods)`; `pay` доступен любому спонсору газа, ETH уходит **строго исходному beneficiary**, reentrancy guard и credit zero до call. Минимум 0.0005 ETH проверяется перед переводом. Невозможность выплатить на ETH-rejecting адрес сохраняет долг и может требовать отдельного продуктового решения; **скрытой смены получателя здесь нет**.
- **30-дневное расписание:** `PwNativeShortProgram` привязывает `launchAt` к записи Pons, а не времени deployment; попытки прежних уже завершённых draw не возрождаются после рестарта. Holder периоды считают по 30 суток от запуска, пропущенные календарные окна не выдумывают исторические balances.
- **Snapshot source:** Pons отдаёт candidate-список, но holder admission **дополнительно** сравнивает `balanceOf` каждого адреса и `totalSupply` в одном finalized block в лимите до 5000 holders / maxRpcCalls, pin code hash и canonical block. Это лучше прежнего `atomicity:unverified` как единственного обоснования, но допустимо только для **действительно проверенных token semantics**, где сумма держателей равна totalSupply. Документ `HOLDER_SNAPSHOT_ADMISSION` отдельно оговаривает такой допуск. Не утверждать, что любой новый токен годится под эти правила.
- **Финансовое деление:** `NativeHolderFeeSplitter` хранит `totalReceived,allocated,credit,roundingReserve` и имеет независимые `deliver(lane)`. Доли 6000/2000/2000 применяются к полученным fees; сервисные ETH-платежи через этот collector не проходят. Direct unsolicited ETH не подменяют `forwardableFees` в PW collector.
- **Выплаты не полностью автоматические:** holder publisher key не передаётся daemon, оператор вручную публикует rounds/claims. Это **выбранная операционная модель**, не отсутствие функции.
- **Local fixture PASS не означает production acceptance:** локальные два платежа по 0.009 ETH, исторический BLS и 0 RPC idle — описание `PW_SERVICE`; независимо не запускал. Настоящего PW token на chain4663 нет. Старые QIANQI/IGW — историческая production-база, их текущее состояние VPS здесь не проверено.

## 5. Что упростить / исправить сейчас (не более пяти)

1. **Общий allowlisted бесплатный RPC gate для PW operator** до любого network I/O — приоритет 1. Старую систему Pons host не переделывать.
2. **Не пропускать необъяснённые финансовые receipts** при продвижении PW funding cursor — строгий ожидаемый event mapping на собственные операции, существующий verified importer.
3. **Явный recovery внешних permissionless-вызовов**: on-demand evidence scan и reconciliation gate до holder allocation. Не превращать его в постоянное сканирование.
4. **Минимальная UI/ops observability:** `contract last verified`, `Pons source last checked`, `holder funding imported through cursor`, `external evidence required`, `publisher operation pending`, `RPC budget remaining`. Честное `paused/unavailable`, без выдуманных live-данных.
5. **Не усложнять:** сохранить один managed vault, один PW launch graph, отдельный holder operator и общий Pons host; не добавлять второй собственный indexer, платные RPC, баланс×время, новый токен для оплаты, buyback/burn или «умную» автоматику начислений.

## 6. Границы принятия реальных денег

До `allowPublicTransactions=true` и первого поступления PW комиссии владельцу нужны:

- Точный **ticker**, verified metadata/URLs/IPFS, approved реальные owner/executor/publisher/project и exclusions (curve/pool/burn/service), уникальность signer/nonce across services.
- Отдельные конкретные ``maxGasPrice/maxGasLimit/nativeFloor`` и **месячный gas reserve/budget** на публичные holder-публикации и множество выплат (20% проектной доли не обязательно покрывают расход при малом объёме). ``0.001 / 0.005 / 0.0005 ETH`` — утверждённые **денежные** пороги, а не газовые.
- PONS ETH creator tax 300 bps поверх base, фиксированный creator fee recipient, реальный bytecode/token semantics/canonical finalized chain и operator source; holder snapshot end-to-end на подтверждённом реальном токене без live денег.
- Отдельное восстановление **owner-launch journal + PW sender journal + holder preparation/plans + holder tx + reconciliation cursor + vault chain state** после `crash before signing / persisted raw before broadcast / unknown response / receipt before DB COMMIT`, cross-project isolation и no double payout.
- Доказанная процедура включения Pons host без запуска старого signer для того же sender/nonce. QIANQI/IGW не должны поменять политики; comparison suite после PW integration.
- Затем отдельная командная/владелецкая approval, хост/сайты/health/alert/backup/rollback. **Это не разрешение выпускать PW по факту зелёных тестов.**

**Тесты следующего пакета, которые стоит реально запустить в локальном checkout:** `npm run test:pw-service`, `npm run test:pw-rehearsal`, `npm run test:pw-production`, `npm run test:holder-schedule`, `npm run test:pw-eth-amounts`, `npm run test:native-worker`, `node --test tests/unit/fee-policy.test.mjs tests/unit/pw-service-config.test.mjs tests/unit/pons-service.test.mjs tests/unit/pons-runtime.test.mjs`, `npm run docs:check`. Fork `test:pw-launch` требует **собственного разрешённого read-only RPC файла**, не искать production секреты/не обращаться к QuickNode. Публиковать результаты с точным HEAD, coverage и тем, что не запускалось.

## 7. Проверенные исходники и ограничения

Адресно прочитал [`docs/PW_SERVICE`](PW_SERVICE.md), [`PW_OPERATOR`](PW_OPERATOR.md), [`PW_LAUNCH_RECOVERY`](PW_LAUNCH_RECOVERY_20261019.md), [`PW_LOCAL_REHEARSAL`](PW_LOCAL_REHEARSAL.md), [`HOLDER_EXECUTION`](HOLDER_EXECUTION.md), [`HOLDER_SNAPSHOT_ADMISSION`](HOLDER_SNAPSHOT_ADMISSION.md), [`HOLDER_PERIODS_RECOVERY`](HOLDER_PERIODS_RECOVERY.md), [`HOLDER_GOVERNANCE`](HOLDER_GOVERNANCE.md), [`PW_INTERIM_FIXES`](PW_INTERIM_FIXES_20261018.md), [`HOLDER_GAS_BENCHMARK`](HOLDER_GAS_BENCHMARK.md), текущие `AGENTS`, `CURRENT_CONTEXT` и `ROADMAP`.

Код: `contracts/holders/{ManagedNativeHolderPayoutVault,NativeHolderPayoutVault,NativeHolderCollector,NativeHolderFeeSplitter,PwNativeShortProgram}.sol`; `src/holders/{admission,program,snapshot,execution}.mjs`; `server/shared/{holder-preparation,holder-execution,pw-holder-operator,pw-service,pw-public,draw-sender,draw-worker,pons-service,pons-runtime,pons-bootstrap}.mjs`; `server/owner-launch/{pw-coordinator,pw-handoff,pw-service-handoff,pw-profile}.mjs`; `src/worker/{pw-policy,production-policy,production-journal}.mjs`; `scripts/pw-operator.mjs` и другие адресные файлы. Не все строки всех документов/файлов просмотрены с одинаковой глубиной.

Не проверял: реальный VPS или базу, production Pons holder API и его лимиты, signer key custody, реальные external funds, onchain deployed bytecode, actual Alchemy fee model, зависимые OpenZeppelin версии и статический Solidity анализ Slither/fuzzing, независимый archive-node snapshot, локальный PostgreSQL binaries/Hardhat/Playwright. `.local`-reports не загружал. **Findings F1–F4 — анализ кода и операционной модели, не наблюдавшиеся реальные инциденты.**

**Одна фраза для Codex:** сначала устранить три операционные прорехи `RPC budget / expected receipts before cursor / external funding reconciliation`, затем подготовить owner UI и зафиксировать реальные параметры. **Не менять 60/20/20, правила билетов/выплат или production QIANQI/IGW.**
