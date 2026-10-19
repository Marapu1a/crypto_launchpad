> 19.10.2026: фронт согласован и опубликован на https://pw.qianqi.site.
> Серверный монитор работает, локальный сборщик остановлен. Подготовка
> вечернего запуска: [результат публикации и подготовки](PW_PRELAUNCH_20261019.md).
> PW не запущен; отправка/подпись выключены. Бюджет предложен, ждёт владельца.

# Порядок работ

19.10.2026: RPC Alchemy и canLaunch владельца PW проверены; свежие fork launch
и local service cycle — PASS. Ориентир запуска 0.000758 ETH при наблюдавшейся
цене газа, без рабочих резервов. Подробности и границы проверки — в
[паспорте запуска](PW_LAUNCH_PASSPORT.md). Производственные лимиты, metadata
и подключение остаются незавершёнными; реальных отправок не было.

Текущий шаг: заполнить [паспорт запуска PW](PW_LAUNCH_PASSPORT.md), затем пройти
общую репетицию выбранного профиля и финальное независимое ревью.

19.10.2026: пакет исправлений ревью — [RPC, receipts и recovery](PW_REVIEW_FIXES_20261019.md).
Реализован и проверен локально. [Экран запуска PW и подпись](PW_OWNER_UI.md)
готовы локально; далее реальные настройки, общая репетиция и ревью.
Production не активирован.

19.10.2026. [Механика и пропорции PW](PATTERN_WATCHER_RULES.md) утверждены.
Пара PW — ETH; пороги утверждены в [правилах PW](PATTERN_WATCHER_RULES.md).

1. **Готово локально:** [подготовка PW](PATTERN_WATCHER_PREPARATION_20261018.md),
   сверка механики IGW как образца, исследование источника холдеров.
2. **Готово локально:** [розыгрыш PW по механике IGW](IGW_MONTHLY_DRAW.md)
   и [вторая пара ETH](NATIVE_ETH.md). Существующий IGW не переделывается.
3. **Готово локально:** [holder ledger](HOLDER_LEDGER.md) и
   [контур подготовки](HOLDER_PREPARATION.md): расчёт 60/20/20, раздельные
   поступления, кандидаты снимков, read-only preview, PostgreSQL/RLS,
   защита от дублей. Финансовое исполнение не подключено.
4. **Готово локально:** [контрактный контур поступлений](HOLDER_FUNDING.md):
   отдельный splitter, накопительный vault, проверка receipts и импорт в БД.
   Vault без вывода средств — для реальных денег непригоден.
   [Замечания промежуточного ревью](PW_INTERIM_FIXES_20261018.md) обработаны:
   trusted importer, admission, отдельный escrow collector и reconciliation.
   [Допуск снимка](HOLDER_SNAPSHOT_ADMISSION.md) проверен локально; production
   профиль конкретного PW runtime и допустимая задержка RPC ещё не выбраны.
   **Готово локально:** [начисления и отдельный контракт выплат](HOLDER_PAYOUT.md).
   **Готово локально:** [журнал исполнения](HOLDER_EXECUTION.md): планы, подписанные
   транзакции, finalized receipts, сверка и восстановление первого периода.
   **Готово локально:** [два периода, импорт прямых выплат и диагностика восстановления](HOLDER_PERIODS_RECOVERY.md).
   **Готово локально:** [PW launch graph, покупки, билеты, draw и два holder-периода](PW_LOCAL_REHEARSAL.md), ограниченный Paid-сканер и восстановление в новом процессе.
   Минимальное управление реализовано локально: [пауза и замена publisher](HOLDER_GOVERNANCE.md). ETH-пороги утверждены; [политика пропусков утверждена и реализована](PW_LAUNCH_RECOVERY_20261019.md).
5. **Готово локально:** [утверждённые ETH-пороги и проверка Pons](PW_ETH_ADMISSION_20261018.md):
   factory/helper/token, ETH eth_call и ограниченная проверка Alchemy на finalized.
   **Готово на локальном fork:** [полный граф PW, журнал запуска и перенос периодов](PW_LAUNCH_RECOVERY_20261019.md).
   **Готово в коде:** [оператор PW](PW_OPERATOR.md), оценка газа, production-профиль,
   holder-handoff и сверка истории порциями. **Дальше:** реальные адреса/лимиты,
   подключение реального owner keystore к готовому UI и финальная настройка служб.
   Fork-репетиция не активирует production.
   После разбора готовности — отдельная задача публичного запуска.

Оплата сервиса ETH, скидки, Web Push/Telegram/сайт — последующий пакет сервиса.
Выкупа и сжигания нет в v1. Действующие QIANQI/IGW не мигрируем ради нового токена.
Текущее состояние: [CURRENT_CONTEXT](CURRENT_CONTEXT.md).

## Holder gas check — 19.10.2026

[Measured local gas and scaling limits](HOLDER_GAS_BENCHMARK.md): PASS for 10/100/500/1,000/5,000 recipients; payouts sampled, totals extrapolated. Resumable reconciliation and actual-network cost preview are now implemented in the PW operator package; production configuration and activation remain pending. No production changes or new financial rules.

## PW operator package — 19.10.2026

[Working launch and holder operator](PW_OPERATOR.md): production profile and disabled-by-default send switch, gas quote, durable exact-byte broadcast/recovery, finalized holder handoff, on-demand holder operations and paged reconciliation (migration 020). No production activation. Owner signing/UI is implemented locally (PW_OWNER_UI.md). Next: choose real launch settings, then complete deployment rehearsal/review. The existing IGW runtime is not a drop-in PW worker.

## PW service package - 19.10.2026

[PW draw/fee adapter](PW_SERVICE.md): separate pinned graph, Pons tickets, event-driven sleep, durable transactions, automatic holder funding import and disabled service registration. Existing token adapters retain their contracts. Holder publication remains an explicit operator workflow. Production activation is separate.
