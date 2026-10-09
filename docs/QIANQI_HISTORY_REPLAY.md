# QIANQI: история покупок и снимки Short

Проверено 09.10.2026, исходная база платформы 05712b9 + новые файлы (точные SHA256 в отчёте). Только чтение публичных данных; production не изменён.

Контрольный блок **84135771**, hash 0x0838573c5fd2fad3760a931a8e109e3c02c069f0612628cc40c5efa02297f78c; anchor 79377859. Выборка содержит **68 CurveBuy, 54 CurveSell, 0 swaps выделенного пула**. Токен ещё на кривой. 53 поздние покупки повторно проверены через committed bundles и route verifier; ещё 13 допущены через direct/self-batch. Две неизвестные покупки остаются WAITING_RECOGNITION, без начисления билетов. Обе позже cutoff второго Short; совпадение снимков не означает, что эти маршруты уже поддерживаются.

Оба snapshot hash совпали с LifecycleFrozen. Также совпали rolling dataset root, число участников/попыток и точные диапазоны из calldata publish, связанные с DatasetChunk/Ready/Sealed.

| Cutoff | Участников | Попыток | Snapshot hash |
| --- | --- | --- | --- |
| 80618862 | 2 | 2 | 0x694d48b1fd5ce481cc5d454393f5f6fdec0a0040f216bdfbd49ba7c6714d0059 |
| 80884521 | 10 | 14 | 0xcfecb93fac1c45594f70fe2e0fe7e1782bc3a6ffb9c7a9dc52ae3074163e8f70 |

Позиция первого on-chain confirmation определяет момент позднего начисления. Carry и оба lane пересчитываются из квалифицированных покупок, продажи билетов не добавляют. Правила ограничены исходной эпохой QIANQI; Monthly frozen dataset и переходы политик требуют отдельного verifier.

## Воспроизведение

- node scripts/qianqi-history-replay.mjs [shadow-capture] [route-capture] [optional-history-cache]
- node tests/qianqi/history.mjs .local/test-results/qianqi-history-2026-10-09T13-19-20-045Z
- node --test tests/unit/qianqi-ticket-shadow.test.mjs tests/unit/qianqi-shadow-reader.test.mjs

Результат: HISTORY_SNAPSHOTS_MATCH; **8 evidence tests +19 соседних unit PASS**. Проверены подмена домена, исключение участника, неверные диапазоны, повтор покупки, ancestry/receipt/runtime и delegation. Evidence-тест использует локальный публичный capture; на свежем checkout сначала необходим сбор данных. RPC URL хранится только в игнорируемом конфиге, в отчёты не попадает.

Артефакты: .local/test-results/qianqi-history-2026-10-09T13-19-20-045Z/report.json, purchases.json, ordinary-evidence.json и numbered RPC captures; прежние снимки сохранены отдельно. Отчёт содержит sourceHashes, блоки, время, provenance и executionEligible=false.

## Границы вывода

BUY genesisHash прочитан из BuyPolicySource 0x4C6fCD1645f15E6eCFc02E74A68ac81e3eD02738: 0x96f08f9d1b0ce23742cd83a32b0803a6516e36d07aadda9276564cb5b70e5e2b. Попытка воссоздать JSON deployment manifest из getters дала другой hash; этот JSON не принят за оригинал. Для домена используется публичный неизменяемый commitment, и с ним воспроизведены оба реальных snapshot hash. Preimage исходного manifest этим не проверен.

Полнота event selection зависит от RPC; отсутствие пропущенных RPC событий не доказано криптографически. Late traces остаются опубликованными publisher/RPC доказательствами, без повторного EVM исполнения. Runtime основных контрактов наблюдается исторически; это не независимая сертификация deployment. Нет проверки RNG/выплат, импорта в PostgreSQL или переключения worker. Денежное исполнение не разрешено.

Следующий предлагаемый пакет: импорт проверенной истории в изолированное PostgreSQL-состояние QIANQI, сравнение с этим replay и восстановление после перезапуска. Затем отдельная проверка RNG/финансовой непрерывности и репетиция передачи одному worker.
