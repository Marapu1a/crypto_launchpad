# Crypto Launchpad

Личный конструктор токенов поверх Pons / Robinhood Chain и общий бэк программ
розыгрышей. Код общий, средства, контракты, билеты, RNG и журналы проектов изолированы.
IGW выпущен, его отдельный worker работает на сервере. Это не утверждение полного
покрытия Pons или готовности любого сочетания настроек к публичному запуску.

## Начать здесь

- [Текущее состояние и незакрытые вопросы](docs/CURRENT_CONTEXT.md).
- [Правила продукта](docs/PRODUCT_SPEC.md) и [очередь работ](docs/ROADMAP.md).
- [Карта всей документации](docs/README.md).
- [Монитор: принятые решения, ещё не реализованные функции](docs/MONITOR_PRODUCT.md).
- [Эксплуатация IGW](docs/OPERATIONS.md) и [карта проверок](docs/TESTING.md).

## Локальная работа

Node.js >=22, npm; Python нужен только экспериментальному монитору.

```powershell
npm ci --ignore-scripts
npm run dev
```

Обычный dev UI: http://127.0.0.1:5173. Production owner UI — отдельный сервер,
не этот dev frontend. Для локальных репетиций есть `npm run owner:draw-rehearsal`;
ему нужны настроенные PostgreSQL и fork. Порядок и зависимости —
[технический документ UI](docs/DRAW_OWNER_UI.md). Не запускать второй стенд на тех же портах.

```powershell
npm test
npm run build
npm run catalog:check
npm run docs:check
python scripts/pons-monitor/test_monitor.py
```

Сборка сайтов: `npm run sites:build`; QIANQI дополнительно требует проверенный
публичный статический снимок через `QIANQI_PUBLIC_SITE_BASE` или локальный каталог.
Этого снимка нет в чистом checkout. [Условия сборки](docs/TOKEN_SITE_KIT.md).

## Структура

| Каталог | Назначение |
|---|---|
| `src/`, `contracts/`, `server/` | Новая реализация и адаптеры |
| `tokens/` | Каталог проектов, исходные изображения, сайты и их настройки |
| `scripts/pons-monitor/` | Локальный read-only монитор первого часа токенов |
| `ops/`, `db/`, `tests/` | Эксплуатация, миграции и проверки |
| `docs/` | Текущее описание, технические материалы и архив отчётов |
| `vendor/qianqi/` | Неизменяемый reference import; не готовая платформа |
| `.local/` | Игнорируемые черновики, приватные настройки и результаты проверок |

Ключи, пароли, RPC credentials, рабочие журналы и production-конфигурации в Git
не входят. Рабочее дерево `D:\sites\rh_project` — отдельный проект; его инструкции
и разрешения автоматически сюда не переносятся. Правила работы: [AGENTS.md](AGENTS.md).
