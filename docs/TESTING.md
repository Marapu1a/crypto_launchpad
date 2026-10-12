# Проверки и пределы доказательств

Сверка 13.10.2026, МСК. Отчёты текущей уборки:
`.local/repo-cleanup-20261012/` (локальное имя каталога сохранило дату начала).

## Этот пакет

| Проверка | Результат / смысл |
|---|---|
| `npm test` |215 unit PASS; текущий накопленный код |
| `npm run build` |PASS; frontend собирается |
| `npm run catalog:check` |PASS; каталог и генерируемые страницы согласованы |
| `npm run docs:check` |PASS; относительные файловые ссылки, без проверки внешних URL/anchors |
| `python scripts/pons-monitor/test_monitor.py` |2 PASS; границы окна/creator/dedup и сигнал |
| Read-only VPS и API |Worker active; фонд 26.850336USDG,6 ожидающих покупок; подробности CURRENT_CONTEXT |

Документы, пути, секреты в публикуемом пакете и git diff проверяются перед commit.
Проверки этого пакета не отправляют финансовые транзакции и не меняют production.

## Уже выполненные профильные проверки

- `tests/contracts/draw-worker-cycle.mjs`: полный isolated PostgreSQL/Hardhat
  цикл трёх конфигураций, restart, low gas, четыре frozen-цикла, late credits,
  выплаты без повторов. PASS12.10; отчёт
  `.local/test-results/draw-worker-2026-10-12T16-30-45-531Z/report.json`.
- Owner receipt/fee recovery, fork и browser — датированные отчёты в
  [архиве](archive/README.md). Не выдавать старые результаты за повторный прогон.
- Сайты: live desktop/mobile12.10, правильная ссылка Pons, без JS errors/overflow;
  `.local/igw-autonomy-20261012/site.json`. Это не проверка платёжной формы.

Повторять успешный тяжёлый прогон следует при изменении соответствующего пути,
новой ошибке или нерешённом риске. Документация сама по себе не требует нового
публичного запуска либо полного fork-набора.

## Выбор команд

- `npm test` — unit; `npm run build` — frontend.
- `npm run test:draw-worker` — изолированный финансовый стенд (нужен PostgreSQL).
- `npm run test:draw-owner-launch` — fork запуска; сначала прочитать настройку RPC.
- `npm run sites:test` — browser при подготовленном preview, не внешний production.
- `npm run check:upstream` — неизменность reference; `test:reference` проверяет
  исходный QIANQI, а не готовность нового продукта.

Ни локальный тест, ни один публичный запуск не доказывают полноту всех маршрутов,
устойчивость любого RPC или доходность токена. Монитор/платные уведомления ещё не
имеют тестов будущих метрик и оплаты, поскольку эти функции не реализованы.
