# USDG/Short: подготовка исполнителя для сети 4663

Продолжение: [контракты и PostgreSQL sender](PRODUCTION_SHORT_CONTRACTS.md).
Ниже — зафиксированный результат первого подготовительного пакета.

10.10.2026. База пакета `5328c8e`. Реализован отдельный кандидат слоя допуска
и журнала, **ещё не подключённый к production runner или UI**. Боевые контракты
не развёрнуты, ключи не создавались/копировались, QIANQI не изменён.

## Что установлено при сравнении

Локальный studio использует `latest` для snapshot и receipt для завершения
операции; его журнал подписывает только 31337. Снимать эти ограничения нельзя.
QIANQI отдельно проверяет finalized history, время объявления recognition,
drand timing, binding/runtime и обязательный writer fence.

Источники: `server/adapters/qianqi/runtime/scripts/drand-timing-readiness.cjs`,
`drand-preflight.cjs`, `prepare-purchase-recognition.cjs`,
`deployment-admission.cjs`, `contracts/RobinhoodControllerChecks.sol` на базе
`5328c8e`. Timing и recognition также прочитаны в исходном
`D:/sites/rh_project`, HEAD `11a050d995f17c2c810db1fe5c4e7a3ec1190ff3`.
Исходники и production-конфиги QIANQI не переносились и не редактировались.

## Реализовано

- `production-policy.mjs`: явная версия политики, chain 4663, project ID,
  разные executor/publisher, hash сборки, anchor, runtime hashes и обязательные
  gas/timing bounds. Проверка сети/anchor/runtime перед исполнением.
- Допуск snapshot требует finalized cutoff и совпадения hash; recognition
  ждёт finalized timestamp >= availableAt. Отсутствие finalized наблюдения —
  повторяемое ожидание; противоречивые блоки/смена ветки — ошибка.
- `production-timing.mjs`: модель QIANQI для clock/finality/beacon/будущего
  раунда. Сверена тестом с оригинальной функцией. Проверка HTTP shape/hash
  недостаточна: `admitBeacon` требует вызова BLS verify через проверенный adapter.
  Даже успешная диагностика не является разрешением отправить транзакцию.
- `production-journal.mjs`: отдельный кандидат исполнителя только zero-value
  calls к закреплённым контрактам. Уникальный action ID, проверка calldata через
  обязательный callback, gas/native budget, повторные admission/lease checks,
  запись точной подписи до broadcast, неизменные nonce/hash при восстановлении.
  Receipt остаётся pending до finalized. Финализированный revert блокирует
  продолжение. Повтор завершённого action не отправляет транзакцию повторно.
- Ключ в policy/journal не нужен: signer внедряется отдельно. Raw подпись до
  завершения остаётся приватным материалом журнала, в history не переносится.
- `npm run check:production`: только чтение RPC/drand, три коротких замера,
  сохранение нового датированного отчёта, без URL/credential в выводе.

Политика не удостоверяет корректность произвольного hash сборки/контрактов.
Потребитель обязан получить их из проверенных artifacts, проверить bindings
и хранить policy неизменно. `admit` обязан проверять конкретный action, dataset,
финальность и RNG; пустой callback не является production интеграцией.
`lease` должен принадлежать PostgreSQL-сессии для **chain + sender**, а не
только project. `save` обязан быть durable/atomic; при ошибке storage runner
должен завершить проход и перечитать состояние перед повтором.

## Текущее наблюдение сети

Отчёт `.local/test-results/production-observation-2026-10-10T03-27-32-331Z.json`.
Три замера 03:27:34–03:27:41 UTC:

| Поле | Наблюдение |
| --- | --- |
| latest | 84682978 → 84683049 |
| finalized | 84672072 |
| finalized hash | `0xae9018b7e61dfa89174795adf8acc2b97a200d7bee6267ecb649d9d2c61704a9` |
| Возраст finalized относительно часов ПК | 1125–1132 секунд |
| Разница latest/finalized | 10906–10977 блоков |
| latest относительно часов ПК | на 4–5 секунд впереди |
| drand относительно часов ПК | на 2–3 секунды впереди |

Это разовый снимок конкретного RPC, не SLA сети и не предел будущей задержки.
Расхождение с wall clock требует проверки синхронизации часов исполнителя;
из этих замеров нельзя определить, чьи часы точнее. Beacon info/shape/hash
проверены, BLS на новом production adapter пока проверить невозможно.
Локальные lead=60/finalityLag=5 **не переносятся**: при таком наблюдении
предварительная проверка должна ждать. Боевые значения в пакете не выбраны.

## Проверки и границы

8 новых тестов: неверная policy/runtime/chain, finalized snapshot и recognition,
обрыв после подписи, неокончательный receipt, повтор action, потеря lease,
занятый nonce, reorg, revert, недоступная finality, gas/native budget, повторный
admission, потерянный broadcast response, подмена gas signer-ом, сравнение timing
с QIANQI и запрет beacon без BLS. Использован настоящий ethers signer с
эфемерным тестовым ключом и моделируемый RPC 4663; отправок в сеть нет.
4 соседних теста локального журнала также прошли.

Этот пакет не проверяет новый sender в PostgreSQL или на настоящих production
artifacts. Старый studio работает прежним локальным путём; новая проверка
не подменяет его runtime и не объявляет готовность реального запуска.

## Следующий шаг

1. Собрать отдельный USDG/Short production template: один drand consumer,
   неизменный контекст/раунд, finalized checkpoint и позднее recognition;
   collector/splitter с 80/15/5 из настроек. Нужен отдельный разбор случая,
   когда freeze не финализировался до публикации выбранного раунда: не reroll.
2. Выбрать явные timing bounds с учётом модели QIANQI и наблюдаемой задержки;
   проверять on-chain значения, clock и финальность непосредственно перед freeze.
3. Подключить sender к PostgreSQL с общей sender lease, конкретным `admit`,
   durable store и отдельным хранилищем ключа на проект. Проверить реальное
   падение процесса/БД и восстановление на точных compiled artifacts.
4. Затем подключать подпись владельца, IPFS и production onboarding/поддомены.

Исходные условия токена не меняются: 2% creator fee, split 80/15/5, билет
10 USDG, фонд от 50 USDG, один слот, 24 часа от settle, победитель не гарантирован.
