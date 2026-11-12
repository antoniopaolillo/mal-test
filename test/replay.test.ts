// Step 5 — the replay: the ten events, in the order the brief lists them,
// turned into a per-day, per-account report.
// Decisions:
// - Events are applied in the listed order. Days are closed PER ACCOUNT, just
//   before that account's next event of a later day (and for all accounts at
//   the end). So E10 (Day 5, ACC-002), listed after E9 (Day 6, ACC-001), is
//   still on time: ACC-002 has not closed Day 5 yet.
// - An event that arrives after its own account already closed that day is
//   rejected and reported; it is never slipped into a closed day.
// - A rejected event is an error line in the report, not a crash: the replay
//   goes on.
// - The Day 6 closing balance includes the capitalized interest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, replay, formatReport } from '../src/replay.ts';
import type { DayReport, ReplayEvent } from '../src/replay.ts';

const report = replay();
const row = (accountId: string, day: number, from = report): DayReport => {
  const found = from.days.find((d) => d.accountId === accountId && d.day === day);
  assert.ok(found, `no report row for ${accountId} Day ${day}`);
  return found;
};

test('the stream is the ten events of the brief, in the listed order', () => {
  assert.deepEqual(EVENTS.map((e) => e.id), ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10']);
  // E10 is booked on Day 5 but listed after E9, which is booked on Day 6.
  assert.deepEqual(EVENTS.slice(-2).map((e) => e.bookedDay), [6, 5]);
});

test('the report has one row per account per day, ordered by day then account', () => {
  assert.equal(report.days.length, 12);
  assert.deepEqual(report.days.slice(0, 4).map((d) => [d.day, d.accountId]),
    [[1, 'ACC-001'], [1, 'ACC-002'], [2, 'ACC-001'], [2, 'ACC-002']]);
});

test('ACC-001 closing balances: 250.00 / 250.00 / 650.00 / 285.00 / -410.00 / 285.80', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => row('ACC-001', d).closingBalance),
    [25000n, 25000n, 65000n, 28500n, -41000n, 28580n]);
});

test('ACC-001 fee assessments: three on Day 5 (for Days 2, 4, 5), all reversed on Day 6', () => {
  assert.deepEqual([1, 2, 3, 4].map((d) => row('ACC-001', d).feesAssessed), [[], [], [], []]);
  assert.deepEqual(row('ACC-001', 5).feesAssessed, [2, 4, 5]);
  assert.deepEqual(row('ACC-001', 5).feesReversed, []);
  assert.deepEqual(row('ACC-001', 6).feesAssessed, []);
  assert.deepEqual(row('ACC-001', 6).feesReversed, [2, 4, 5]);
});

test('ACC-001 authorization states at each close', () => {
  assert.deepEqual(row('ACC-001', 1).authorizations, {});
  assert.deepEqual(row('ACC-001', 2).authorizations, { 'Auth-A': 'ACTIVE' });
  assert.deepEqual(row('ACC-001', 3).authorizations, { 'Auth-A': 'ACTIVE' });
  assert.deepEqual(row('ACC-001', 4).authorizations, { 'Auth-A': 'SETTLED', 'Auth-Z': 'SETTLED_WITHOUT_AUTH' });
  assert.deepEqual(row('ACC-001', 5).authorizations,
    { 'Auth-A': 'SETTLED', 'Auth-Z': 'SETTLED_WITHOUT_AUTH', 'Auth-B': 'DECLINED' });
  // Auth-B stays declined after E9 (criterion 6 refused).
  assert.equal(row('ACC-001', 6).authorizations['Auth-B'], 'DECLINED');
});

test('ACC-001 available balance at each close: the hold shows on Days 2 and 3 only', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((d) => row('ACC-001', d).available),
    [25000n, 5000n, 45000n, 28500n, -41000n]);
});

test('ACC-001 accrued interest at each close, and the Day 6 capitalization', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => row('ACC-001', d).accruedInterest),
    [10n, 20n, 46n, 57n, 10n, 80n]);
  assert.equal(row('ACC-001', 5).interestCapitalized, undefined);
  assert.equal(row('ACC-001', 6).interestCapitalized, 80n);
});

test('errors: the only one in the stream is E6, reported on Day 4 of ACC-001', () => {
  assert.deepEqual(row('ACC-001', 4).errors, ['E6: NO_AUTHORIZATION']);
  const others = report.days.filter((d) => !(d.accountId === 'ACC-001' && d.day === 4));
  assert.ok(others.every((d) => d.errors.length === 0));
});

test('ACC-002: zero until Day 5, then 10.000 and 10.008; interest 0.004 + 0.004', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((d) => row('ACC-002', d).closingBalance),
    [0n, 0n, 0n, 0n, 10000n, 10008n]);
  assert.deepEqual([5, 6].map((d) => row('ACC-002', d).accruedInterest), [4n, 8n]);
  assert.equal(row('ACC-002', 6).interestCapitalized, 8n);
  assert.equal(row('ACC-002', 6).currency, 'BHD');
});

test('listed order vs day order: moving E10 before E9 changes nothing', () => {
  const byDay = [...EVENTS.slice(0, 8), EVENTS[9]!, EVENTS[8]!];
  assert.deepEqual(replay(byDay), report);
});

test('a replayed event is reported and changes nothing', () => {
  const again = replay([...EVENTS, { ...EVENTS[0]!, bookedDay: 6 }]);
  const day6 = row('ACC-001', 6, again);
  assert.equal(day6.errors.length, 1);
  assert.ok(day6.errors[0]!.startsWith('E1: REJECTED'));
  assert.equal(day6.closingBalance, 28580n);
});

test('an event arriving after its account closed that day is rejected, not slipped in', () => {
  const late: ReplayEvent = { id: 'X1', bookedDay: 3, type: 'CREDIT', accountId: 'ACC-001', currency: 'AED', amount: '100.00', valueDate: 3 };
  const withLate = replay([...EVENTS, late]); // arrives after E9 (Day 6): Day 3 is long closed
  const day3 = row('ACC-001', 3, withLate);
  assert.equal(day3.errors.length, 1);
  assert.ok(day3.errors[0]!.startsWith('X1: REJECTED'));
  assert.equal(row('ACC-001', 6, withLate).closingBalance, 28580n);
});

test('formatReport prints amounts at currency precision and names the error', () => {
  const text = formatReport(report);
  for (const expected of ['Day 1', 'Day 6', 'ACC-001', 'ACC-002', '-410.00', '285.80', '10.008', 'E6: NO_AUTHORIZATION', 'DECLINED']) {
    assert.ok(text.includes(expected), `report text should contain "${expected}"`);
  }
});
