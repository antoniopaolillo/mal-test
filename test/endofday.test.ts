// Step 4 — end of day: overdraft fees and interest accrual.
// Spec rules:
// - Overdraft fee AED 25.00, once per day per account, when that day's closing
//   ledger balance (all entries with value_date <= that day) is negative.
//   Booked with value_date equal to the day assessed.
// - Interest 0.04% per day on positive closing balances; accruals capitalize as
//   one credit at the end of Day 6; the rounded daily accruals must sum exactly
//   to the capitalized total.
// Decisions:
// - Closing day D re-evaluates EVERY day from 1 to D, in order, because a
//   back-valued entry can change a day that was already closed. A day that
//   turned negative gets its fee late; a day that stopped being negative gets
//   its fee reversed. Nothing is edited: fees and reversals are new entries.
// - The fee test for day d ignores day d's own fee (otherwise the fee would
//   justify itself), but fees of earlier days do count: they are ledger entries.
// - Interest accruals live outside the ledger until capitalization. Each day's
//   rounded accrual is round(cumulative exact) - round(previous cumulative), so
//   the rounding residual is carried forward instead of being discarded
//   (criterion 8 refused).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.ts';
import { Authorizations } from '../src/authorizations.ts';
import { EndOfDay } from '../src/endofday.ts';
import type { DayCloseResult } from '../src/endofday.ts';

const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);

// Replays ACC-001 day by day, closing each day, up to and including `lastDay`.
function replayAcc001(lastDay: number) {
  const ledger = new Ledger();
  const auths = new Authorizations(ledger);
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-001', 'AED');
  const acc = 'ACC-001';
  const aed = 'AED';
  const days: Array<() => void> = [
    () => {
      ledger.post({ accountId: acc, ref: 'E1', kind: 'CREDIT', currency: aed, amount: 120000n, bookedDay: 1, valueDate: 1 });
      ledger.post({ accountId: acc, ref: 'E2', kind: 'DEBIT', currency: aed, amount: -95000n, bookedDay: 1, valueDate: 1 });
    },
    () => { auths.authorize({ accountId: acc, authId: 'Auth-A', ref: 'E3', currency: aed, amount: 20000n, day: 2 }); },
    () => { ledger.post({ accountId: acc, ref: 'E4', kind: 'CREDIT', currency: aed, amount: 40000n, bookedDay: 3, valueDate: 3 }); },
    () => {
      auths.settle({ accountId: acc, authId: 'Auth-A', ref: 'E5', currency: aed, amount: 18500n, bookedDay: 4, valueDate: 4 });
      auths.settle({ accountId: acc, authId: 'Auth-Z', ref: 'E6', currency: aed, amount: 18000n, bookedDay: 4, valueDate: 4 });
    },
    () => {
      ledger.post({ accountId: acc, ref: 'E7', kind: 'DEBIT', currency: aed, amount: -62000n, bookedDay: 5, valueDate: 2 });
      auths.authorize({ accountId: acc, authId: 'Auth-B', ref: 'E8', currency: aed, amount: 9000n, day: 5 });
    },
    () => { ledger.reverse({ originalRef: 'E7', ref: 'E9', bookedDay: 6, valueDate: 2 }); },
  ];
  const results: DayCloseResult[] = [];
  for (let day = 1; day <= lastDay; day++) {
    days[day - 1]!();
    results.push(eod.close(acc, day));
  }
  const balances = (upTo: number) => Array.from({ length: upTo }, (_, i) => ledger.balance(acc, i + 1));
  // Net accrual recorded for each day so far, e.g. [10n, 10n, 26n].
  const accruedByDay = (upTo: number) =>
    Array.from({ length: upTo }, (_, i) => sum(eod.accruals(acc).filter((a) => a.forDay === i + 1).map((a) => a.amount)));
  return { ledger, auths, eod, results, balances, accruedByDay };
}

// ---------------------------------------------------------------- fee rule

test('a negative closing balance gets one fee, value-dated and booked on that day', () => {
  const ledger = new Ledger();
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-001', 'AED');
  ledger.post({ accountId: 'ACC-001', ref: 'D1', kind: 'DEBIT', currency: 'AED', amount: -100n, bookedDay: 1, valueDate: 1 });
  const result = eod.close('ACC-001', 1);
  assert.equal(result.feesAssessed.length, 1);
  const fee = result.feesAssessed[0]!;
  assert.equal(fee.kind, 'FEE');
  assert.equal(fee.amount, -2500n);
  assert.equal(fee.valueDate, 1);
  assert.equal(fee.bookedDay, 1);
  assert.equal(result.closingBalance, -2600n); // the reported close includes the fee
});

test('once per day: closing the same day again assesses nothing new', () => {
  const ledger = new Ledger();
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-001', 'AED');
  ledger.post({ accountId: 'ACC-001', ref: 'D1', kind: 'DEBIT', currency: 'AED', amount: -100n, bookedDay: 1, valueDate: 1 });
  eod.close('ACC-001', 1);
  const again = eod.close('ACC-001', 1);
  assert.deepEqual(again.feesAssessed, []);
  assert.deepEqual(again.accruals, []);
  assert.equal(ledger.entries('ACC-001').length, 2); // the debit and one fee
});

test('a zero closing balance is not negative: no fee, and no interest either', () => {
  const ledger = new Ledger();
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-001', 'AED');
  ledger.post({ accountId: 'ACC-001', ref: 'C1', kind: 'CREDIT', currency: 'AED', amount: 100n, bookedDay: 1, valueDate: 1 });
  ledger.post({ accountId: 'ACC-001', ref: 'D1', kind: 'DEBIT', currency: 'AED', amount: -100n, bookedDay: 1, valueDate: 1 });
  const result = eod.close('ACC-001', 1);
  assert.deepEqual(result.feesAssessed, []);
  assert.equal(result.accruedTotal, 0n);
});

test('each negative day gets its own fee, and yesterday\'s fee is part of today\'s balance', () => {
  const ledger = new Ledger();
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-001', 'AED');
  ledger.post({ accountId: 'ACC-001', ref: 'D1', kind: 'DEBIT', currency: 'AED', amount: -100n, bookedDay: 1, valueDate: 1 });
  eod.close('ACC-001', 1);
  const day2 = eod.close('ACC-001', 2);
  assert.equal(day2.feesAssessed.length, 1);
  assert.equal(day2.feesAssessed[0]!.valueDate, 2);
  assert.equal(day2.closingBalance, -5100n); // -1.00, two fees
});

test('the fee is defined in AED only: an overdrawn BHD account gets an error, not a guessed fee', () => {
  // The spec gives "AED 25.00" and no FX rate. Charging BHD 25.000 would be ~10x the AED fee.
  const ledger = new Ledger();
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-002', 'BHD');
  ledger.post({ accountId: 'ACC-002', ref: 'D1', kind: 'DEBIT', currency: 'BHD', amount: -1000n, bookedDay: 1, valueDate: 1 });
  const result = eod.close('ACC-002', 1);
  assert.deepEqual(result.feesAssessed, []);
  assert.deepEqual(result.errors, ['OVERDRAFT_FEE_NOT_CONFIGURED']);
  assert.equal(result.closingBalance, -1000n);
});

// ------------------------------------------------- the stream, Days 1 to 4

test('Days 1-4: no fees; closing balances 250.00 / 250.00 / 650.00 / 285.00', () => {
  const { results, balances } = replayAcc001(4);
  assert.deepEqual(results.map((r) => r.closingBalance), [25000n, 25000n, 65000n, 28500n]);
  assert.deepEqual(balances(4), [25000n, 25000n, 65000n, 28500n]);
  assert.ok(results.every((r) => r.feesAssessed.length === 0 && r.feesReversed.length === 0 && r.errors.length === 0));
});

test('Days 1-4: daily accruals 0.10 / 0.10 / 0.26 / 0.11, accrued total 0.57', () => {
  // Day 4 exact interest is 285.00 x 0.04% = 0.114; cumulative exact 0.574 rounds to 0.57.
  const { results, accruedByDay, ledger } = replayAcc001(4);
  assert.deepEqual(accruedByDay(4), [10n, 10n, 26n, 11n]);
  assert.deepEqual(results.map((r) => r.accruedTotal), [10n, 20n, 46n, 57n]);
  // Accruals are not ledger entries: the balance has not moved.
  assert.equal(ledger.balance('ACC-001', 4), 28500n);
});

// ------------------------------------------------------ Day 5: E7 arrives

test('criterion 2 refused: E7 causes THREE fees at the Day 5 close, for Days 2, 4 and 5', () => {
  const { results } = replayAcc001(5);
  const day5 = results[4]!;
  assert.deepEqual(day5.feesAssessed.map((f) => f.valueDate), [2, 4, 5]);
  assert.ok(day5.feesAssessed.every((f) => f.amount === -2500n && f.bookedDay === 5));
});

test('Day 5 view: -395.00 / +5.00 / -385.00 / -410.00 — Day 3 stays positive and is not charged', () => {
  // Day 2: 250 - 620 = -370 (criterion 1), then its fee -> -395.
  // Day 3: -395 + 400 = +5, not negative, no fee.
  // Day 4: +5 - 185 - 180 = -360, fee -> -385.  Day 5: -385, fee -> -410.
  const { results, balances } = replayAcc001(5);
  assert.deepEqual(balances(5), [25000n, -39500n, 500n, -38500n, -41000n]);
  assert.equal(results[4]!.closingBalance, -41000n);
});

test('Day 5: interest already accrued on days that turned negative is taken back, by new records', () => {
  // Exact cumulative is now 0.10 (Day 1) + 0.002 (Day 3 on +5.00) = 0.102 -> 0.10.
  const { results, accruedByDay, eod } = replayAcc001(5);
  assert.deepEqual(accruedByDay(5), [10n, 0n, 0n, 0n, 0n]);
  assert.equal(results[4]!.accruedTotal, 10n);
  // Append-only here too: the original accruals are still there, offset by adjustments.
  const day5Records = results[4]!.accruals;
  assert.deepEqual(day5Records.map((a) => [a.forDay, a.amount]), [[2, -10n], [3, -26n], [4, -11n]]);
  assert.ok(day5Records.every((a) => a.bookedDay === 5));
  assert.equal(eod.accruals('ACC-001').length, 7); // 4 original + 3 adjustments
});

// ------------------------------------------------------ Day 6: E9 arrives

test('Day 6: reversing E7 reverses the three fees with compensating entries', () => {
  const { results, ledger } = replayAcc001(6);
  const day6 = results[5]!;
  assert.deepEqual(day6.feesAssessed, []);
  assert.deepEqual(day6.feesReversed.map((r) => r.valueDate), [2, 4, 5]);
  assert.ok(day6.feesReversed.every((r) => r.amount === 2500n && r.bookedDay === 6 && r.reversesRef !== undefined));
  // Criterion 6 refused: the net is zero but the record is not empty.
  const fees = ledger.entries('ACC-001').filter((e) => e.kind === 'FEE');
  assert.equal(fees.length, 3);
  assert.equal(ledger.entries('ACC-001').length, 13); // E1 E2 E4 E5 E6 E7, 3 fees, E9, 3 fee reversals
});

test('Day 6 view: 250.00 / 250.00 / 650.00 / 285.00 / 285.00 / 285.00', () => {
  const { balances, ledger } = replayAcc001(6);
  assert.deepEqual(balances(6), [25000n, 25000n, 65000n, 28500n, 28500n, 28500n]);
  // The view as known at the end of Day 5 is still answerable.
  assert.equal(ledger.balance('ACC-001', 5, 5), -41000n);
});

test('Day 6: daily accruals 0.10 / 0.10 / 0.26 / 0.11 / 0.12 / 0.11 sum to exactly 0.80', () => {
  // Exact total: 0.10 + 0.10 + 0.26 + 3 x 0.114 = 0.802 -> 0.80.
  // Rounding each day on its own gives 0.11 three times and a total of 0.79:
  // one fil of the customer's interest would vanish. Carrying the residual
  // puts it on Day 5 (cumulative 0.688 -> 0.69).
  const { results, accruedByDay } = replayAcc001(6);
  assert.deepEqual(accruedByDay(6), [10n, 10n, 26n, 11n, 12n, 11n]);
  assert.equal(sum(accruedByDay(6)), 80n);
  assert.equal(results[5]!.accruedTotal, 80n);
});

// ---------------------------------------------------------- capitalization

test('capitalize posts one INTEREST credit equal to the sum of the daily accruals', () => {
  const { eod, ledger, accruedByDay } = replayAcc001(6);
  const entry = eod.capitalize('ACC-001', 6);
  assert.ok(entry !== undefined);
  assert.equal(entry.kind, 'INTEREST');
  assert.equal(entry.amount, 80n);
  assert.equal(entry.valueDate, 6);
  assert.equal(entry.amount, sum(accruedByDay(6))); // the spec invariant, literally
  assert.equal(ledger.balance('ACC-001', 6), 28580n); // AED 285.80
  assert.equal(ledger.entries('ACC-001').filter((e) => e.kind === 'INTEREST').length, 1);
});

test('capitalize refuses to run twice for the same account', () => {
  const { eod } = replayAcc001(6);
  eod.capitalize('ACC-001', 6);
  assert.throws(() => eod.capitalize('ACC-001', 6));
});

test('capitalize with nothing accrued posts nothing', () => {
  const ledger = new Ledger();
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-001', 'AED');
  eod.close('ACC-001', 1);
  assert.equal(eod.capitalize('ACC-001', 1), undefined);
  assert.deepEqual(ledger.entries('ACC-001'), []);
});

// ------------------------------------------------------------------ ACC-002

test('ACC-002: BHD 10.000 on Day 5 accrues 0.004 on Days 5 and 6 and closes at 10.008', () => {
  const ledger = new Ledger();
  const eod = new EndOfDay(ledger);
  ledger.openAccount('ACC-002', 'BHD');
  for (let day = 1; day <= 4; day++) {
    const r = eod.close('ACC-002', day);
    assert.equal(r.closingBalance, 0n);
    assert.deepEqual(r.accruals, []); // nothing to record on a zero balance
  }
  [3333n, 3333n, 3334n].forEach((amount, i) => {
    ledger.post({ accountId: 'ACC-002', ref: `E10/${i + 1}`, kind: 'CREDIT', currency: 'BHD', amount, bookedDay: 5, valueDate: 5 });
  });
  assert.equal(eod.close('ACC-002', 5).accruedTotal, 4n); // 10.000 x 0.04% = 0.004
  assert.equal(eod.close('ACC-002', 6).accruedTotal, 8n);
  assert.equal(eod.capitalize('ACC-002', 6)!.amount, 8n);
  assert.equal(ledger.balance('ACC-002', 6), 10008n);
});
