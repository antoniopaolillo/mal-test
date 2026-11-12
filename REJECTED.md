# REJECTED

Two parts: the acceptance criteria I refuse, and the approaches I started or
considered and dropped during the build.

## Acceptance criteria

Five of the eight criteria are refused. Three are accepted; they are listed
too, because accepting a criterion is also a claim.

| # | Verdict | Deciding fact |
| --- | --- | --- |
| 1 | Accepted | 250.00 - 620.00 = -370.00 |
| 2 | **Refused** | E7 causes three fees, not one |
| 3 | Accepted | Auth-A is active and 185.00 <= 200.00 |
| 4 | **Refused** | A settlement is a fact, not a request |
| 5 | Accepted | Conditional statement; true whenever Auth-B is approved |
| 6 | **Refused** | Auth-B stays declined and the record does not return |
| 7 | **Refused** | 3 x 3.334 = 10.002 |
| 8 | **Refused** | Contradicts the non-negotiable interest rule |

### Criterion 2 — "E7 causes exactly one overdraft fee, on Day 2" — refused

E7 is value-dated Day 2, so it lowers every closing balance from Day 2 on.
Evaluated at the end of Day 5:

| Day | Balance before that day's fee | Fee | Close |
| --- | --- | --- | --- |
| 2 | -370.00 | yes | -395.00 |
| 3 | +5.00 | no | +5.00 |
| 4 | -360.00 | yes | -385.00 |
| 5 | -385.00 | yes | -410.00 |

Three days are negative, so three fees are assessed: for Days 2, 4 and 5. The
400.00 credit on Day 3 lifts that one day to +5.00 and nothing more. This does
not depend on the criterion 4 decision: with E6 rejected, Day 4 would be
-180.00 before its fee and the same three days would be charged.

Test: `criterion 2 refused: E7 causes THREE fees at the Day 5 close` in
`test/endofday.test.ts`.

### Criterion 4 — "Any settlement referencing an authorization ID not present in the ledger must be rejected and the funds must not leave the account" — refused

An authorization is a request and can be declined. A settlement is a
notification that the money has already moved: by the time it reaches the
issuer's ledger, the card scheme has settled between the banks. Rejecting it
does not bring the funds back; it only makes the ledger disagree with reality,
showing 180.00 in the customer's account that the bank no longer holds.

Settlements with no matching authorization are also a normal occurrence, not
only a fault: offline transactions, an authorization that expired before a
late presentment, approvals given by the scheme on the issuer's behalf while
the issuer was unreachable.

So E6 is posted (Day 4 closes at 285.00) and reported as an error,
`E6: NO_AUTHORIZATION`, which is where a dispute or chargeback would start.
The word "any ... must" is what makes the criterion wrong; as a default for a
closed-loop system with no external scheme it would be reasonable.

This is the refusal I am least certain of, because it rests on how card
clearing works rather than on arithmetic. The cost of being wrong is bounded
and documented: `AMBIGUITIES.md` A14 gives the numbers under the other reading
(final balance 466.02), and the fee days are the same either way.

Test: `E6: a settlement with no authorization is posted AND reported` in
`test/authorizations.test.ts`.

### Criterion 6 — "After E9, all balances and fees return to their pre-E7 values" — refused

After E9 the closing balances by value date are what they would have been
without E7, and the three fees are offset by three compensating entries. If
the criterion said only that, it would hold. "All ... return" does not:

- **Auth-B does not return.** It was declined on Day 5 because E7 had made the
  balance -335.00. Without E7 it would have been approved (available 195.00
  after the hold). E9 does not un-decline it: the customer's payment failed.
- **The fees were not un-assessed.** They are still in the ledger, each next
  to its reversal. The fee assessments printed for Day 5 remain three.
- **Accrued interest took a detour.** 0.57 on Day 4, 0.10 on Day 5, 0.80 on
  Day 6; the Day 5 figure was true when printed.
- **"Pre-E7 values" for Days 5 and 6 never existed.** E7 arrived on Day 5.
- **The record never returns.** An append-only ledger now holds E7, E9, three
  fees and three fee reversals. Asked "what was Day 2 as known at the end of
  Day 5?", it still answers -395.00.

Test: `criterion 6 refused: reversing E7 does not un-decline Auth-B` in
`test/authorizations.test.ts`.

### Criterion 7 — "The three BHD instalments in E10 must each be BHD 3.334" — refused

3 x 3.334 = 10.002. The account would be credited two fils that nobody paid.
BHD 10.000 cannot be split into three equal amounts at three decimal places;
the instalments are 3.333 / 3.333 / 3.334 and sum to exactly 10.000.

Test: `splitEqually: E10` in `test/money.test.ts`.

### Criterion 8 — "If the rounded daily interest accruals do not sum to the capitalized total, the remainder is discarded" — refused

The rules say the rounded daily accruals **must** sum exactly to the
capitalized total, and call that non-negotiable. A criterion that describes
what to do when they do not is describing a state the system must never be in.
It is also the customer's money: rounding each day alone gives 0.79 against an
exact total of 0.802, and "discarding the remainder" would keep one fil.

The design makes the mismatch impossible instead: the capitalized credit is
the sum of the daily records, and each daily record is the difference between
two rounded cumulative totals. Daily accruals 0.10 / 0.10 / 0.26 / 0.11 / 0.12
/ 0.11 = 0.80.

Test: `Day 6: daily accruals ... sum to exactly 0.80` and `capitalize posts
one INTEREST credit equal to the sum of the daily accruals` in
`test/endofday.test.ts`.

### The accepted criteria, briefly

- **1.** Day 2 holds +1,200.00, -950.00 and, once E7 is booked, -620.00:
  -370.00 before any fee. With its fee the same day closes at -395.00.
- **3.** Auth-A was approved on Day 2 (available 50.00 after the hold) and is
  still active on Day 4. The settlement is for less than the hold. Accepted
  with no exception; the hold is released in full.
- **5.** True as a conditional. In this replay Auth-B is declined, so the
  condition is never met; a separate test approves it (without E7) and checks
  that ledger balance stays 285.00 while available drops to 195.00.

## Approaches abandoned

**Rounding interest per day.** The throwaway replay written before the
repository existed computed interest both ways. Rounding each day on its own
summed to 0.79. Dropped for cumulative rounding before any repository code
was written.

**Fees stand after a reversal.** Considered leaving the three fees in place
after E9, to be waived manually. Dropped in favour of automatic compensating
entries; the trade-off is in `AMBIGUITIES.md` A6.

**Rejecting E6.** Considered following criterion 4 literally. Dropped; see above.

**One global clock, events sorted by day.** Considered sorting the stream by
booked day and closing all accounts together. Dropped because the brief says
"replayed in this order". Replaced by per-account day
closing, which honours the listed order and gives the same report.

**A dedicated `FEE_REVERSAL` entry kind.** Planned in step 2. Dropped in step
4: a fee reversal is an ordinary `Ledger.reverse()` of the fee entry, so it
inherits the "an entry is reversed at most once" rule for free. Fee reversals
are told apart by what they point at.

**Running `src/replay.ts` directly.** The scaffold's `npm run replay` executed
the replay module itself. Dropped when the tests needed to import it without
printing; the entry point moved to `src/main.ts`.

**Fixing the authorization-key gap.** The review of step 3 found that a
settlement naming another account releases the original hold. A one-line guard
was considered and dropped: the proper fix re-keys the authorization log by
(account, authorization id) and needs a decision on hold expiry. Kept as the
annotated failing test instead.

**Guarding `close()` after `capitalize()`.** Found in the review of step 4.
Not fixed: the window ends at Day 6. Documented in `AMBIGUITIES.md` A34.
