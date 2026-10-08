# Проверяемая случайность Short — 08.10.2026

Новый local-only вариант LocalDrandShortProgram наследует денежный цикл Short.
При freeze он атомарно создаёт запрос отдельному LocalDrandAdapter: один consumer,
один request на context, будущий раунд вычисляется из timestamp+lead. Если запрос
не создан, freeze откатывается целиком. Нет смены раунда, отмены или администратора
случайности. Seed выводится из проверенной подписи и домена chain/adapter/request/
consumer/context. Программа принимает fulfill только от своего adapter.

settle по-прежнему сверяет frozen participantsHash, но теперь требует именно seed,
полученный от adapter; вызвать его может любой. Ручной seed не проходит даже от
оператора. В старом LocalShortProgram ручной seed сохранён для прежних тестовых
фикстур; новый RNG-профиль нужно выбирать явно при deployment.

Адаптация: vendor/qianqi/contracts/DrandRandomAdapter.sol ae445254. Сохранены
публичный ключ evmnet, BLS verify и seed derivation; два consumer заменены одним,
профиль переименован, добавлено ограничение chain31337. BLS.sol/ModExp.sol и LICENSE
скопированы без изменения из vendor, source QIANQI не менялся.

## Источник и чтение

Официальный endpoint https://api.drand.sh/04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3/info
прочитан08.10.2026: chain/key/genesis/period/scheme совпали с QIANQI.
Публичные подписанные результаты берутся с того же endpoint `/public/<round>`.
src/randomness/drand.mjs сверяет профиль, номер раунда, формат и sha256(signature).
Это не криптографическая проверка BLS: подпись аутентифицирует контракт.

prove и deliver разделены. Ошибка callback сохраняет proven seed и позволяет
повторить доставку. deliverRequest перечитывает on-chain proven/delivered перед
действием: повторный запуск не выбирает другой раунд. Неизвестный исход отправки
выдаётся вызывающему; нового nonce/seed helper сам не подбирает. Полноценного
долговечного transaction journal/keeper в этом модуле ещё нет.

## Проверено

- `npm run test:drand`:4сценария с архивной подписью, включая неверные proof/round,
  запрет ручного seed/fulfill/re-freeze, повторный prove/deliver, недостаточный gas
  callback и восстановление, совпадение JS результата и выплаты.
- `npm run test:drand:live`:4сценария со свежим раундом21316976, выбранным и
  зафиксированным до публикации. Дождались настоящей подписи (~1мин), локальный
  EVM проверил её и исполнил выплаты. Live-прогон завершился до добавления
  отдельной проверки gas-failure, которая затем прошла в offline-прогоне.
- 2unit проверки API data/profile.
- 10соседних контрактных сценариев Short/split сохранили PASS после добавления hooks.

Отчёты .local/test-results/drand-2026-10-08T15-05-30-422Z.json (live),
drand-2026-10-08T15-06-31-670Z.json (offline),
short-cycle-2026-10-08T15-05-33-410Z.json (регрессия).

## Границы

Все контракты/выплаты только на изолированной31337; никаких mainnet отправок.
В live-тесте настоящая будущая подпись drand, но блок-время локальной EVM
контролируется тестом. Lead60сек/clockLag5/ahead5/finalizedLag5/beaconLag10 —
тестовые параметры, не утверждённая конфигурация production. В архивном тесте
часы выставлены до известного старого раунда: это проверка кода, не непредсказуемости.

BLS не доказывает свежесть часов цепочки, finality freeze или полноту участников.
Timing limits в adapter сами по себе не реализуют off-chain preflight. Mainnet
нужны проверки finality/clock/beacon freshness, больший согласованный lead,
publisher/индексатор, журнал доставки и мониторинг. Участников ещё задаёт оператор.
JS-экран остаётся отдельным ручным симулятором; автоматический deploy нового
профиля/UI-прогресс доставки и сквозной запуск Pons→индексатор→drand ещё впереди.
