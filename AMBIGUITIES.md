# AMBIGUITIES

Every place where the brief can be read more than one way, the reading I took,
and what would change under the other reading. Items marked **changes the
numbers** alter the replay output; the rest only define behaviour the stream
never reaches.

## Overdraft fee

**A1. "Booked with value_date equal to the day assessed" — which day?**
When E7 arrives on Day 5 and makes Day 2 negative, "the day assessed" can mean
the day being judged (Day 2) or the day the judging happened (Day 5).
*Resolution:* the day being judged. The fee for Day 2 has `valueDate` 2 and
`bookedDay` 5. The entry carries both days, so neither reading loses
information. **Changes the numbers:** under the other reading Day 3 would
close at +30.00 instead of +5.00, and all three fees would sit on Day 5.

**A2. Is a past day charged at all when it turns negative later?**
The rule says a fee is assessed when "that day's closing ledger balance (all
entries with value_date <= that day)" is negative. It does not say when the
check runs. *Resolution:* every close re-evaluates every day from 1 to the
current day. Criterion 1 ("evaluated at end of Day 5") and criterion 2 ("on
Day 2") both presuppose this. **Changes the numbers:** checking only the
current day would charge Day 5 alone.

**A3. "Once per day per account" — per day judged, or per close run?**
The Day 5 close posts three fees. *Resolution:* "per day" is the day the fee
is for. Each day has at most one active fee; one close may post several, each
for a different day.

**A4. Does a day's own fee count in the balance that triggers it?**
If it did, any charged day would stay "negative because of its fee".
*Resolution:* the test for day d uses the balance of day d without day d's own
fee. Fees of earlier days do count: they are ledger entries with an earlier
value date. **Changes the numbers:** this is why Day 3 is +5.00 (the Day 2 fee
is in it) and still not charged.

**A5. Which "closing balance" is reported?**
*Resolution:* the one after the day's fee, and on Day 6 after capitalization.
Criterion 1 explicitly asks for a balance "before any fee is assessed"
(-370.00); the report shows -395.00 for the same day once the fee exists. Both
are produced; `NUMBERS.md` lists the pre-fee figure.

**A6. After E9 reverses E7, do the three fees stand?**
The fees were correct when assessed. After E9 the days they were for are no
longer negative. *Resolution:* each close also reverses any fee whose day is
no longer negative, with a new compensating entry (same value date, booked on
the day of the close). Reasoning: a reversal with the original value date says
the entry should never have counted; the customer should not pay a fee for it.
This is a policy choice. **Changes the numbers:** if fees stood until a manual
waiver, ACC-001 would end at 210.70 (210.00 plus 0.70 interest) instead of 285.80.

**A7. The fee is in AED; ACC-002 is in BHD.**
*Resolution:* no fee is defined for BHD. An overdrawn BHD account gets no fee
and the close reports `OVERDRAFT_FEE_NOT_CONFIGURED`. Not reached by the stream.

## Interest

**A8. How are the daily accruals rounded so that they "sum exactly"?**
*Resolution:* round the cumulative exact total and take differences, so the
residual carries to the next day. See `NUMBERS.md`. **Changes the numbers:**
0.80 instead of 0.79.

**A9. Which balance earns interest?**
*Resolution:* the closing ledger balance after that day's fee, by value date,
as currently known. Holds do not reduce it (interest is on ledger balance, not
available balance).

**A10. A past balance changes after interest was accrued on it.**
On Day 4 the accrued total is 0.57; E7 then makes Days 2, 4 and 5 negative.
*Resolution:* accruals are re-derived at every close and corrected by appended
adjustment records (negative amounts), never by editing. The total drops to
0.10 on Day 5 and returns to 0.80 on Day 6. **Changes the numbers:** without
re-accrual, Day 5 would keep the zero it earned while it looked negative and
the capitalized total would be 0.69 instead of 0.80.

**A11. Simple or compound inside the window?**
*Resolution:* accrued interest is not part of the ledger balance until it is
capitalized, so it earns nothing before Day 6. "Capitalize as a single credit
at end of Day 6" implies exactly this.

**A12. Is Day 6 interest computed before or after the capitalization credit?**
*Resolution:* before. Day 6 accrues on 285.00, then the 0.80 credit is posted
with value date Day 6 and appears in the Day 6 closing balance (285.80).

**A13. Zero balance.** No interest ("positive only") and no fee ("negative").

## Authorizations and settlements

**A14. A settlement that references an unknown authorization (E6).**
The brief flags it and criterion 4 says to reject it. *Resolution:* post it
and report `NO_AUTHORIZATION`. Full reasoning in `REJECTED.md`.
**Changes the numbers:** rejecting it would leave Day 4 at 465.00 and the
final balance at 466.02; the fee days would be the same.

**A15. Settlement amount differs from the hold (185.00 against 200.00).**
*Resolution:* the actual amount is debited and the whole hold is released. A
settlement above the hold is posted in full and reported as
`SETTLED_ABOVE_HOLD`. Only the "below" case occurs in the stream.

**A16. A settlement against a declined or an already settled authorization.**
*Resolution:* same principle as A14: posted, and reported as
`AUTHORIZATION_DECLINED` or `AUTHORIZATION_ALREADY_SETTLED`. Not reached.

**A17. What balance is Auth-B checked against?**
E8 arrives on Day 5 after E7, before the Day 5 close. *Resolution:* the ledger
balance at the moment of the request, -335.00; the fees of that close do not
exist yet. Available after the hold would be -425.00: declined. Under any
reading considered (E6 rejected, fees already charged) it is still declined.

**A18. Is Auth-B reconsidered after E9?**
After the reversal the balance would have covered the hold. *Resolution:* no.
An authorization decision is an event that happened; the merchant was told
"declined" on Day 5. It stays `DECLINED`.

**A19. "Auth-B is never settled inside the window."**
This reads as if Auth-B were approved and left open. In this replay it is
declined, so there is nothing to settle. If it were approved, the hold would
stay active past Day 6: the model has no expiry.

**A20. The "value_date" of an authorization.**
A hold is not a ledger entry and has no value date. *Resolution:* the field is
ignored for authorizations; the hold takes effect on the day it arrives.
Holds are also not day-aware: `available(account, day)` subtracts every active
hold whatever `day` is, so it is only meaningful for the current day.

**A21. Are debits and settlements subject to the available-balance check?**
The rule constrains authorizations only. *Resolution:* debits and settlements
are never refused for lack of funds. E7 takes the account to -335.00.

**A22. Duplicate authorization id; authorization arriving after its own
settlement.** *Resolution:* both are rejected as "id already used". The second
case can legitimately happen with out-of-order messages; this model does not
handle it.

**A23. Authorization ids are assumed globally unique.**
A settlement naming a different account than the one the hold is on is treated
as a normal settlement. This is a real defect of the design, kept as the
annotated failing test (`test/known-gap.failing.test.ts`).

## Entries, reversals and instalments

**A24. "Three equal instalments" of BHD 10.000.**
They cannot be equal at 3 decimal places. *Resolution:* 3.333 / 3.333 / 3.334.
Also ambiguous: whether instalments fall on different days. *Resolution:* the
event gives one value date, so all three are booked and value-dated on Day 5.
**Changes the numbers:** spreading them over days would change ACC-002's
interest.

**A25. Must a reversal carry the original's value date?**
E9 does. *Resolution:* the ledger accepts any value date on a reversal; the
rule is not enforced either way.

**A26. What can be reversed?** Any entry once; a reversal cannot itself be
reversed (re-post the original under a new ref instead).

**A27. Opening balance 0.00.** No opening entry is posted; an empty account
has balance zero.

**A28. Future value dates and invalid days.** Accepted without validation; no
event uses them.

**A29. Instalments are not atomic.** If a later instalment were rejected, the
earlier ones would stay posted. Not reached: a replayed E10 fails on its first
instalment.

## Replay and report

**A30. "Replayed in this order", but E10 (Day 5) is listed after E9 (Day 6).**
*Resolution:* events are applied strictly in the listed order, and days are
closed per account. When E10 arrives, ACC-002 has not closed Day 5, so E10 is
on time. Sorting by day gives the identical report (there is a test for it).

**A31. An event for a day its account has already closed.**
*Resolution:* rejected and reported on that day's row. A back-dated *value*
date is legitimate; a back-dated *booking* day is not.

**A32. What is an "error" in the report?**
*Resolution:* rejected events (`<id>: REJECTED: <reason>`) and settlements
posted with an exception (`E6: NO_AUTHORIZATION`). A declined authorization is
a state, not an error.

**A33. On which day does a late fee appear in the report?**
*Resolution:* on the day of the close that posted it (Day 5), labelled with the
day it is for (Days 2, 4, 5).

**A34. After capitalization.** Closing a day again after the interest credit
is not guarded and could add accruals beyond the capitalized total. The window
ends at Day 6, so the replay never does it.
