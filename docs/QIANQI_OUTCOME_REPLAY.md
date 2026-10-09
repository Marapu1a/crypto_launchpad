# QIANQI: независимый пересчёт исходов Short

09.10.2026, база169fb66. Новая реализация src/qianqi/outcome-replay.mjs вычисляет исход из seed, context, участников и правил. Значения shortResult используются только для сравнения, не для выбора победителей или назначения сумм. Проверены два исторических Short на84135771; production и сервер не изменялись.

## Результат

Статус **INDEPENDENT_SHORT_OUTCOMES_MATCH**. Совпали порядок победителей, amounts, prizeIndices, admittedCount и resultHash; назначения сверены с ранее проверенными выплатами.

| Розыгрыш | Допущено / победителей | Выплачено USDG | resultHash |
| --- | --- | --- | --- |
| Первый | 1 / 1 | 6.963644 | 0xd93c3977ba79232ed0819db7ebefcfb9ae7c0274889bc4c639ccc0dd1a3c18b0 |
| Второй | 4 / 4 | 53.115936 | 0x365137c42bb7863ab45e1e64cc593fa48f7e8bfb90f84dfe3b5a52dc7802b59e |

Фактические правила обоих розыгрышей: p=4/5, h=1; веса7:4:2:1:1:1:1:1:1:1, minimumUnit=5000000 raw USDG. Это исторические входные данные QIANQI, не новые универсальные настройки платформы.

## Независимые вычисления

1. Повторно проверяются исходные BUY/recognition/lifecycle/snapshot evidence через verifyHistoryArchive и RNG/обязательства через inspectFinance. Сохранённым статусам отчётов доверие не требуется.
2. Из DatasetProposed берутся rules, weights, minimumUnit и budget. Пересчитываются outcome rules hash, policy hash, корзина призов и basket hash. Policy hash сверяется с frozen snapshot.
3. Пересчитывается SHORT_DATASET_CONTEXT_V1 с chain/controller/instance/registry/vault/quote/request. Он должен совпасть с проверенным RNG context.
4. Для каждого участника e=lastAttempt-firstAttempt+1, threshold=floor(2^256*p*e/(e+h)). Admission hash сравнивается с threshold строго через <. Все операции BigInt, без float и округления денежной суммы через Number.
5. Допущенные кошельки ранжируются через SHORT_ORDER_V1, призовые слоты отдельно через SHORT_PRIZE_ORDER_V1. Один приз на адрес, максимум K победителей, отсутствие победителя допустимо. При равных rank используются wallet или исходный индекс слота.
6. Итоговый hash использует **SHORT_DATASET_RESULT_V1 и rolling dataset root**; поле resultHash внутри кодируемого Result сначала нулевое. Legacy SHORT_RESULT_V1 с плоским participants hash здесь неприменим.

Корзина строится через unit=floor(budget/sum(weights)); минимальная единица проверяется до назначения призов. Остаток округления корзины составил9 и15 raw USDG соответственно. Это отдельно от сумм невыданных призовых слотов, возвращённых vault в свободный резерв.

## Доказательства и воспроизведение

- node scripts/qianqi-outcome-replay.mjs
- node tests/qianqi/outcome.mjs .local/test-results/qianqi-outcome-2026-10-09T16-31-15-083Z
- node tests/qianqi/finance.mjs .local/test-results/qianqi-finance-2026-10-09T15-21-08-436Z

**7 новых сценариев PASS**, включая24 сравнительных вектора арифметики с существующим модулем платформы, и **8 соседних финансовых сценариев PASS**. Проверены нулевой исход,1/10/64слота, uint128/uint256 границы, minimumUnit, переполнение суммы весов, подмены seed/context/participants/rules/weights, независимость от переданного результата контроллера. Основной положительный oracle — реальные captured shortResult и resultHash обоих контрактных розыгрышей; сравнение с JS-модулем — дополнительная проверка, не самостоятельное on-chain доказательство.

Финальный отчёт .local/test-results/qianqi-outcome-2026-10-09T16-31-15-083Z/report.json содержит hashes исходников, исходные archive paths и для каждого участника threshold/random/rank/admitted. Более ранний снимок16-29-23 сохранён отдельно. Дополнительная provenance: .local/notes/qianqi-outcome-2026-10-09.json.

Исходные форматы/алгоритм: frozen vendor ae445254, contracts/ShortOutcome.sol, ShortPrizeBasket.sol, ShortRulesEpochs.sol, ShortDatasetPreparation.sol, ShortSettlement.sol. Vendor не изменялся и не импортируется новым runtime-модулем.

## Границы

Закрыта зависимость вычисления исходов этих двух Short от ответа контроллера. Сохраняются доверие к историческим RPC/полноте event selection и BLS verify через исторический контракт, без отдельной локальной проверки pairing. Это не аудит всего bytecode или consensus proof. Monthly outcome, будущие смены правил, приватный nonce/journal и handoff не проверены. Live shadow пока не запускает этот полный outcome replay автоматически для каждого нового цикла.

Следующий предлагаемый пакет — read-only обследование сервера и конкретный план отдельного shadow-окружения: существующие сервисы, ресурсы, БД/роли, поддомены, резервные копии, объём сохраняемых данных. Установка/переключение финансового исполнителя остаются отдельным согласованным этапом.
