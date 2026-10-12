# Модуль розыгрышей v2

Текущее устройство 13.10.2026. [Правила продукта](PRODUCT_SPEC.md) определяют
смысл; файлы исходников ниже — точные технические ограничения.

- `src/draws/config.mjs`: USDG-арифметика bigint, порог билетов, доли,
  Short-корзина и базовая конфигурация. Пресет QIANQI не является чтением сети.
- `src/draws/program-config.mjs`: v2, Short до 604800 секунд, Monthly2592000 секунд,
  явная доля Short и финансирование каждого включённого типа.
- `short-outcome.mjs` / `monthly-outcome.mjs`: отдельные алгоритмы результата.
  Short может завершиться без победителей; Monthly не заменяется Short-корзиной.
- `server/owner-launch/draw-coordinator.mjs`: план и продолжение owner-launch-v2.
- `server/shared/draw-worker.mjs`: финансовое исполнение, recognition и циклы.

Есть конструктор, контракты, PostgreSQL worker и публичный read model.
Short/Monthly/оба прошли локальную сквозную проверку. IGW работает в основной сети
только с Short-профилем. Это не проверка всех допустимых параметров в production.

Short-корзина: `unit=floor(budget/sum(weights))`, `prize=unit*weight`;
невыданное и остаток округления сохраняются. Количество 1–64 задаёт максимум
призовых мест, не обещание такого числа победителей. Monthly — один слот.
Средства и RNG-контекст отдельных типов/проектов не смешиваются.

Для использования: [owner UI](DRAW_OWNER_UI.md), [worker](DRAW_WORKER.md),
[модель фондов](DRAW_FUNDING_MODEL.md). История пакетов 1–7 и их ограниченных
проверок: [архив](archive/snapshots/DRAW_MODULE.md).
