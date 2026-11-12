# WORKLOG

Times in UTC. Built with Claude as an AI pair, as the brief permits.

- 2026-11-12 ~11:22 (approximate) — Read the brief. Replayed the stream in a throwaway script outside the repo to pin the numbers before designing: closing balances by value_date, three overdraft fees caused by E7 (Days 2, 4, 5), Auth-B declined, interest 0.79 with naive per-day rounding vs 0.80 with the residual carried forward.
- 2026-11-12 ~11:25 (approximate) — First pass over the acceptance criteria: 1, 3, 5 correct; 2, 4, 6, 7, 8 to be refused. Criterion 4 flagged as the highest-risk judgement call.
- 2026-11-12 11:30 — Decisions: TypeScript; after E9 the fees are reversed automatically with compensating entries. E6 (Auth-Z) still open.
- 2026-11-12 11:30 — Scaffold: package.json (Node >= 22.18 runs .ts directly, no build step, no runtime dependencies), tsconfig, .gitignore.
- 2026-11-12 11:37 — E6 decided: post the debit and record an exception (criterion 4 refused). Working method: tests are written first, with Claude drafting them; the core implementation is hand-written against them.
- 2026-11-12 11:37 — Step 1: money tests written before the implementation. Decisions baked in: bigint minor units, input with excess precision is rejected, the instalment remainder goes to the last instalments, half-even rounding.
- 2026-11-12 12:46 — Step 1 implemented: src/money.ts passes all 10 money tests. Reviewed; no changes required.
- 2026-11-12 15:20 — Step 2: ledger tests written before the implementation. Decisions baked in: entries carry both bookedDay and valueDate (bitemporal balance query), stored entries are frozen, refs are unique (idempotent replay), currency must match the account, a reversal is a new linked entry and an entry can be reversed only once.
- 2026-11-12 16:30 — Step 2 implemented: src/ledger.ts passes all 11 ledger tests (21 in total). Reviewed; one optional hardening noted (post() accepts kind REVERSAL without a link).
