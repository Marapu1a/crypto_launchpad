# Crypto Launchpad

Один репозиторий для хаба, монитора Pons, интерфейса запуска и обслуживания токенов.
Приложения запускаются и выпускаются отдельно. Контракты, деньги, билеты, RNG,
кошельки и журналы экземпляров остаются изолированными.

## Начать здесь

- [Текущее состояние](docs/CURRENT_CONTEXT.md), [план](docs/ROADMAP.md).
- [Правила продукта](docs/PRODUCT_SPEC.md), [решения по монитору](docs/MONITOR_DECISIONS_20261016.md).
- [Карта проекта и перенос](docs/REPOSITORY_LAYOUT_PLAN.md), [документация](docs/README.md).
- [Обслуживание QIANQI и IGW](docs/PONS_RELEASE_20261014.md).

## Структура

| Каталог | Назначение |
|---|---|
| `apps/hub/` | Хаб и каталог проектов |
| `apps/monitor/` | Сборщик Pons, история и интерфейс наблюдений |
| `apps/launch/` | Страницы и клиентский код запуска/управления |
| `tokens/QIANQI/`, `tokens/IGW/` | Сайты, оформление и профили токенов |
| `src/` | Общая логика, интеграция Pons и компоненты сайтов |
| `server/` | Общий API, обслуживание и адаптер QIANQI |
| `contracts/`, `db/`, `config/` | Контракты, миграции и настройки/шаблоны |
| `scripts/`, `ops/`, `tests/` | Сборка, эксплуатация и проверки |
| `docs/` | Решения, инструкции и архив отчётов |
| `vendor/qianqi/` | Неизменяемый reference, не активный исходник |
| `.local/` | Приватные материалы, данные, сборки и результаты проверок |

## Локальный запуск

Node.js >=22, npm; Python 3 для монитора и простого preview хаба.

```powershell
npm ci --ignore-scripts
npm run dev
# Интерфейс запуска: http://127.0.0.1:5173

npm run monitor
# Монитор: http://127.0.0.1:4196 — не запускать второй экземпляр на той же базе

npm run sites:build
npm run sites:preview
# QIANQI :4200, IGW :4201, хаб :4202
```

Сайты собираются из репозитория, без скрытого внешнего снимка QIANQI.
Preview по умолчанию не обращается к публичным API. Отдельный статический хаб:
`npm run hub:preview` (:4212).

`npm run build` собирает `apps/launch` в прежний `dist/`, сохраняя маршруты
`/`, `/draws.html`, `/launch.html`, `/owner.html`, `/project.html`.
Production owner UI и финансовые исполнители запускаются отдельно по инструкции
выпуска, а не через dev-сервер.

## Проверки

```powershell
npm run build
npm run sites:build
npm run catalog:check
npm run docs:check
npm run test:monitor
npm run check:qianqi-runtime
npm run test:qianqi-runtime
```

Браузерные проверки сайтов требуют `npm run sites:preview`: затем `npm run sites:test`.
Остальные проверки — [TESTING](docs/TESTING.md).

`D:\sites\rh_project` сохранён как прежний checkout и источник истории. Для текущей
платформы работаем здесь; не запускаем из него второго финансового исполнителя.
Ключи, production-конфиги и финансовое состояние не переносятся в Git.
Правила работы: [AGENTS.md](AGENTS.md).
