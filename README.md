# In-memory account ledger core

An append-only, in-memory ledger for two accounts over a six-day window. It
replays the ten events of the brief and prints, per day and per account:
closing ledger balance, fee assessments, authorization states and errors.

No web layer, no persistence, no database, no runtime dependencies.

## Requirements

Node.js 22.18 or newer. Node runs the TypeScript sources directly (type
stripping), so there is no build step and nothing to install to run it.

## Run it

```sh
npm test          # the test suite
npm run replay    # the per-day report
```

`npm test` ends with **69 passing and 1 failing, on purpose**. The failing
test is `test/known-gap.failing.test.ts`: the annotated test against my own
design that the brief asks for. Its header comment says what it reveals and
why it is not fixed. Any other failure is a real one.

Optional, for type-checking only:

```sh
npm install
npm run typecheck
```

## Read the output

`npm run replay` prints one block per day and, inside it, one group per
account. Days 4 to 6:

```text
Day 4
------------------------------------------------------------------------
  ACC-001   closing     AED 285.00   available     AED 285.00
      fees assessed        none
      authorizations       Auth-A SETTLED, Auth-Z SETTLED_WITHOUT_AUTH
      errors               E6: NO_AUTHORIZATION
      accrued interest     AED 0.57
  ACC-002   closing      BHD 0.000   available      BHD 0.000
      fees assessed        none
      authorizations       none
      errors               none
      accrued interest     BHD 0.000

Day 5
------------------------------------------------------------------------
  ACC-001   closing    AED -410.00   available    AED -410.00
      fees assessed        Day 2, Day 4, Day 5 (AED 25.00 each, AED 75.00 total)
      authorizations       Auth-A SETTLED, Auth-Z SETTLED_WITHOUT_AUTH, Auth-B DECLINED
      errors               none
      accrued interest     AED 0.10
  ACC-002   closing     BHD 10.000   available     BHD 10.000
      fees assessed        none
      authorizations       none
      errors               none
      accrued interest     BHD 0.004

Day 6
------------------------------------------------------------------------
  ACC-001   closing     AED 285.80   available     AED 285.80
      fees assessed        none
      fees reversed        Day 2, Day 4, Day 5 (AED 25.00 each, AED 75.00 total)
      authorizations       Auth-A SETTLED, Auth-Z SETTLED_WITHOUT_AUTH, Auth-B DECLINED
      errors               none
      accrued interest     AED 0.80
      interest capitalized AED 0.80
  ACC-002   closing     BHD 10.008   available     BHD 10.008
      fees assessed        none
      authorizations       none
      errors               none
      accrued interest     BHD 0.008
      interest capitalized BHD 0.008
```

Each line, in the order printed:

| Line | Meaning |
| --- | --- |
| `closing` | Ledger balance of that day: every entry with `value_date` up to that day, fees included. On Day 6 it includes the capitalized interest. |
| `available` | Ledger balance minus active holds, at the close. |
| `fees assessed` | Overdraft fees posted by this day's close, listed by the day each one is for. A back-valued entry can make a close charge earlier days (Day 5 charges Days 2, 4 and 5). |
| `fees reversed` | Fees taken back by this close because the day they were for is no longer negative. Printed only when there are any. |
| `authorizations` | State of every authorization the account has seen so far. |
| `errors` | Events that were rejected, and settlements that were posted without a usable authorization behind them. |
| `accrued interest` | Interest accrued so far. It is not part of the balance until it is capitalized. |
| `interest capitalized` | The single interest credit, on Day 6. |

Three things in the output that look odd and are intended:

- **Accrued interest goes down on Day 5** (0.57 to 0.10). E7 is booked on Day 5
  with value date Day 2 and makes Days 2, 4 and 5 negative, so interest already
  accrued for those days is taken back.
- **Auth-B stays `DECLINED` on Day 6**, after E9 reverses E7. The decision was
  made on Day 5 with what the ledger knew then; a reversal does not un-decline
  a payment that already failed.
- **E6 is an error and the money still left the account.** A settlement is
  posted even with no authorization behind it, and reported. See `REJECTED.md`,
  criterion 4.

## Layout

| Path | What it holds |
| --- | --- |
| `src/money.ts` | Amounts as `bigint` minor units: parse, format, split into instalments, round half-even |
| `src/ledger.ts` | The append-only entry list, balance by value date, reversal |
| `src/authorizations.ts` | Holds, the approval rule, settlements and their exceptions |
| `src/endofday.ts` | Overdraft fees with retroactive re-evaluation; interest accrual and capitalization |
| `src/replay.ts` | The event stream, the replay loop and the report |
| `src/main.ts` | Prints the report |
| `test/` | One test file per module, written before the module |

## Documents

- `NUMBERS.md` — every constant, and why that value
- `AMBIGUITIES.md` — every ambiguity found in the brief and how it was resolved
- `REJECTED.md` — the acceptance criteria refused, with reasons, and the approaches abandoned
- `WORKLOG.md` — the timestamped log of the build
