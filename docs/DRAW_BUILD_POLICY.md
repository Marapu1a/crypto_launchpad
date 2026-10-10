# Сборка и проверка связей v2

10.10.2026, база082de02. Три режима конструктора, отдельные от v1.
`npm run build:draw-programs` сохраняет artifacts/manifest в новый локальный
каталог draw-v2-*. Сборка содержит Short, Monthly, распределитель, collector,
splitter, recognition и RNG. Fixture/harness-контрактов в ней нет.

Текущий buildHash:
`0x2824a5d90a5160f42449e82ad770e57d68c9124dbf99177da396b74dd853f640`.
Schema manifest `draw-production-build-v2`, identity включает compiler/settings,
sourceHashes и данные всех артефактов. Проверяются EVM-пределы creation/runtime.
Старый compileProduction default и его hash24fe240d… не изменены.

## Policy и проверки

`src/worker/draw-policy.mjs` принимает только draw-production-policy-v2 с
шаблоном draw-template-v2, конфигурацией2, project/instance ID, разными ролями
executor/publisher, явными gas/timing limits и anchor. Состав контрактов строго
соответствует включённым типам. Не допускаются лишние роли, отсутствующие фонды,
дубликаты адресов или произвольный buildHash. Доверенная сборка компилируется
локальным кодом verifier, не берётся из пользовательского manifest.

Read-only verifyDrawPolicy проверяет уже развёрнутые контракты:

- Сеть4663, anchor и один общий наблюдаемый блок для всех code/getter reads;
  повторная проверка hash блока в конце.
- Все runtime hashes, для наших контрактов также runtime template из доверенной
  сборки. Immutable участки маскируются по данным compiler, затем параметры
  сверяются getter-вызовами: asset/оператор/instance/RNG, интервалы/фонды/веса,
  nextTarget, routing shares, team/operations и publisher.
- Pons token/curve/factory/router/escrow/hook, collector→splitter→fundingRouter,
  отдельные program→adapter→consumer; регистрация factory и creator fee.
- Отсутствие скрытого дополнительного веса и solvent фондов/splitter/router.

Это не разрешение подписывать: результат содержит authorizationToSend=false.
Проверка deployed runtime не заменяет проверку constructor calldata до создания;
построение и подпись v2 deployment-плана — следующий пакет.
V1-validator намеренно отвергает v2, прежний worker не может случайно начать её
обслуживать. В этом пакете не расширялись его исполнение, DB schema или UI.

## Пределы доверия

Внешние Pons/quote контракты проверяются по policy pins и связям, а не по
официальному глобальному allowlist: перед настоящим запуском нужно проверить
актуальный deployment Pons. Policy должна быть закреплена доверенным журналом;
самосогласованный пользовательский JSON не является разрешением владельца.

Проверки не доказывают полноту набора покупок/билетов, finalized статус observation,
notice по истории создания recognition или достаточность газа всего цикла.
Recognition availableAt надо учитывать в будущей проверке execution admission;
не выводить готовность к confirm из одного успешного bindings-check.
Не включены дополнительные batch-маршруты: неизвестные роли пока запрещены.
Нижняя допустимая длительность Short в production ещё требует связи с timing.

## Проверка

`npm run test:draw-policy`:2 интеграционных сценария PASS, первый разворачивает
все3 режима из доверенных v2 artifacts на изолированной chain4663 с Pons fixtures.
Второй отвергает неверную сборку/режим/доли/instance/Next/веса/split/timing/fee,
совпавшие роли, изменённые anchor/code и чужую сеть. Дополнительно заменяет
runtime вместе с согласованным codeHash: verifier отклоняет чужой artifact.
15 unit/соседних PASS (старый production journal11, config v2 4).
CLI build PASS, v1 buildHash отдельно подтверждён неизменным.

Отчёт `.local/test-results/draw-policy-2026-10-10T19-23-15-833Z/report.json`,
manifest рядом. Сборка `.local/builds/draw-v2-2026-10-10T19-24-05-782Z/`.
Публичных транзакций нет, QIANQI не изменён.

Далее: versioned owner deployment planner, constructor calldata/адресные связи,
сохранение и продолжение трёх режимов. Затем новый worker/ledger/UI, отдельная
репетиция полных циклов и серверное подключение по разрешению владельца.
