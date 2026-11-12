# NUMBERS

Every constant in the code, split by where it comes from. "Given" constants
are copied from the brief and are not mine to tune. "Chosen" constants are
decisions, and each one says why that value and not a smaller, larger or
different one.

## Given by the brief

| Constant | Value | Where | Note |
| --- | --- | --- | --- |
| Overdraft fee | AED 25.00 (`2500n` fils) | `OVERDRAFT_FEE_AMOUNT`, `OVERDRAFT_FEE_CURRENCY` in `src/endofday.ts` | Stated in AED only. See "Chosen" for what that means for a BHD account. |
| Daily interest rate | 0.04% | `INTEREST_RATE_NUMERATOR = 4n`, `INTEREST_RATE_DENOMINATOR = 10000n` | The representation as a fraction is a choice; see below. |
| AED precision | 2 decimal places | `PRECISION` in `src/money.ts` | |
| BHD precision | 3 decimal places | `PRECISION` in `src/money.ts` | |
| Window | Days 1 to 6 | `LAST_DAY = 6` in `src/replay.ts` | Capitalization happens at the close of `LAST_DAY`. |
| Instalments of E10 | 3 | `instalments: 3` on the event | |
| Approval threshold | available balance >= 0 after the hold | `authorize` in `src/authorizations.ts` | Zero is approved: "at or above zero". |

## Chosen

### Amounts are integers in the minor unit (scale 100 for AED, 1000 for BHD)

AED 250.00 is stored as `25000n`. The scale is exactly the currency precision,
not finer. A finer scale (say, 1/10000 of a dirham everywhere) would let
sub-fil amounts sit in the ledger, and the brief says amounts are stored at
their own precision. A coarser scale cannot represent the amounts at all.
`bigint` rather than `number` so that no operation can silently lose a unit.

### The interest rate is the fraction 4 / 10000, never 0.0004

Interest for one day is `balance_in_minor_units * 4 / 10000`. Keeping the rate
as two integers means the running total can be held exactly, as an integer
count of 1/10000 of a minor unit, and rounded once. The fraction is left
unreduced (it equals 1/2500) because 4 and 10000 are the digits a reader sees
in "0.04%". Reducing it would change no result.

### Interest is rounded on the cumulative total, half-even

Each day's accrual is `round(cumulative exact) - round(previous cumulative)`.

- Why cumulative and not per day: rounding each day alone gives 0.11 for each
  of Days 4, 5 and 6 and a total of 0.79, while the exact total is 0.802 and
  rounds to 0.80. One fil would be lost, which is the "discarded remainder"
  the rules forbid. With cumulative rounding the daily accruals are
  0.10 / 0.10 / 0.26 / 0.11 / 0.12 / 0.11 and sum to 0.80 by construction.
- Why half-even and not half-up: half-up biases every tie in the same
  direction, and over many accounts that bias is real money. Half-even has no
  systematic direction. Honest note: no value in this replay lands on a tie,
  so the mode changes no number here.

### Fee trigger is strictly below zero; interest is strictly above zero

A closing balance of exactly 0.00 gets no fee ("negative") and no interest
("positive balances only"). There is no tolerance band: a band of even one fil
would be a number I invented.

### The instalment remainder goes to the last instalments, one unit each

10.000 / 3 = 3.333 with 0.001 left over, so the instalments are
3.333 / 3.333 / 3.334. Putting the extra unit last is a convention (the final
instalment "closes" the amount). First would be equally valid; what is not
negotiable is that the parts sum to exactly 10.000. Spreading one unit per
instalment, rather than giving the whole remainder to one, keeps the
instalments within one minor unit of each other.

### A settlement releases 100% of the hold

Auth-A holds 200.00 and settles for 185.00; the whole hold is released, not
185.00 of it. Keeping the unused 15.00 on hold would block the customer's
money for a purchase that is finished. Partial captures (several settlements
against one authorization) are not modelled; a second settlement is posted and
reported as an exception.

### No fee for non-AED accounts (zero, with an error, rather than 25.000 BHD)

The fee is given as "AED 25.00" with no FX rate. Charging 25.000 BHD would be
roughly ten times the AED fee; converting would need a rate I do not have. An
overdrawn BHD account therefore gets no fee and the close reports
`OVERDRAFT_FEE_NOT_CONFIGURED`. ACC-002 is never negative, so this path is not
exercised by the stream.

### Counters start at 1

Entry `seq`, authorization-record `seq`, accrual `seq` and the counter in fee
refs (`FEE:ACC-001:D2:1`) start at 1, matching the brief's Day 1 and E1.

### Cosmetic numbers in the report

The rule line is 72 characters, amounts are right-aligned to 14 and labels
padded to 20. They affect alignment only.

## Deliberately absent

These are numbers a production ledger needs and this one does not have. Each
is a constant I refused to invent without a source.

| Missing constant | Consequence here |
| --- | --- |
| Hold expiry (days) | An approved authorization that never settles holds the amount forever. |
| Settlement tolerance over the hold (tip, fuel, FX) | Any amount above the hold is posted and reported as `SETTLED_ABOVE_HOLD`. |
| Maximum back-value window | An entry can be value-dated on any earlier day; each close re-evaluates from Day 1. |
| Fee cap per period | Three fees in one close (Day 5) are all charged. |
| FX rates | No cross-currency posting or fee. |

## Numbers the replay produces

For cross-checking against the output.

| Number | Value | Derivation |
| --- | --- | --- |
| Day 2 close, seen from Day 5, before fees | AED -370.00 | 250.00 - 620.00 |
| Day 3 close, seen from Day 5 | AED +5.00 | -370.00 - 25.00 fee + 400.00 |
| Day 5 close | AED -410.00 | -335.00 - 3 x 25.00 |
| Auth-B available after the hold | AED -425.00 | -335.00 - 90.00 (declined) |
| Interest capitalized, ACC-001 | AED 0.80 | exact 0.802 |
| Final close, ACC-001 | AED 285.80 | 285.00 + 0.80 |
| Interest capitalized, ACC-002 | BHD 0.008 | 2 x 10.000 x 0.04% |
| Final close, ACC-002 | BHD 10.008 | 10.000 + 0.008 |
