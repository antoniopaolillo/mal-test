// Step 3 — authorizations, holds and settlements.
// Spec rule: an authorization is approved only if available balance
// (ledger balance minus active holds) stays at or above zero after the hold.
// Decisions:
// - A hold is NOT a ledger entry. It lives in its own append-only log, so it
//   can reduce available balance without ever touching the ledger balance.
// - A settlement is not a request, it is a notification that money has already
//   moved. It is always posted. When there is no usable authorization behind
//   it, it is posted AND reported as an exception (criterion 4 refused).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.ts';
import { Authorizations } from '../src/authorizations.ts';

// ACC-001 at the end of Day 1: AED 250.00.
function setup(): { ledger: Ledger; auths: Authorizations } {
  const ledger = new Ledger();
  ledger.openAccount('ACC-001', 'AED');
  ledger.post({ accountId: 'ACC-001', ref: 'E1', kind: 'CREDIT', currency: 'AED', amount: 120000n, bookedDay: 1, valueDate: 1 });
  ledger.post({ accountId: 'ACC-001', ref: 'E2', kind: 'DEBIT', currency: 'AED', amount: -95000n, bookedDay: 1, valueDate: 1 });
  return { ledger, auths: new Authorizations(ledger) };
}

const AUTH_A = { accountId: 'ACC-001', authId: 'Auth-A', ref: 'E3', currency: 'AED', amount: 20000n, day: 2 } as const;
const E4 = { accountId: 'ACC-001', ref: 'E4', kind: 'CREDIT', currency: 'AED', amount: 40000n, bookedDay: 3, valueDate: 3 } as const;
const SETTLE_A = { accountId: 'ACC-001', authId: 'Auth-A', ref: 'E5', currency: 'AED', amount: 18500n, bookedDay: 4, valueDate: 4 } as const;
const SETTLE_Z = { accountId: 'ACC-001', authId: 'Auth-Z', ref: 'E6', currency: 'AED', amount: 18000n, bookedDay: 4, valueDate: 4 } as const;
const E7 = { accountId: 'ACC-001', ref: 'E7', kind: 'DEBIT', currency: 'AED', amount: -62000n, bookedDay: 5, valueDate: 2 } as const;
const AUTH_B = { accountId: 'ACC-001', authId: 'Auth-B', ref: 'E8', currency: 'AED', amount: 9000n, day: 5 } as const;

test('with no holds, available balance equals ledger balance', () => {
  const { auths } = setup();
  assert.equal(auths.activeHolds('ACC-001'), 0n);
  assert.equal(auths.available('ACC-001', 1), 25000n);
});

test('E3: Auth-A is approved — 250.00 minus a 200.00 hold leaves 50.00 available', () => {
  const { ledger, auths } = setup();
  const record = auths.authorize(AUTH_A);
  assert.equal(record.type, 'APPROVED');
  assert.equal(auths.status('Auth-A'), 'ACTIVE');
  assert.equal(auths.activeHolds('ACC-001'), 20000n);
  assert.equal(auths.available('ACC-001', 2), 5000n);
  // Criterion 5: the hold reduces available balance, not ledger balance.
  assert.equal(ledger.balance('ACC-001', 2), 25000n);
  assert.equal(ledger.entries('ACC-001').length, 2);
});

test('the approval boundary is zero: exactly the available amount passes, one fil more does not', () => {
  const exact = setup();
  assert.equal(exact.auths.authorize({ ...AUTH_A, amount: 25000n }).type, 'APPROVED');
  assert.equal(exact.auths.available('ACC-001', 2), 0n);

  const over = setup();
  assert.equal(over.auths.authorize({ ...AUTH_A, amount: 25001n }).type, 'DECLINED');
});

test('a declined authorization is recorded but places no hold', () => {
  const { auths } = setup();
  auths.authorize({ ...AUTH_A, amount: 25001n });
  assert.equal(auths.status('Auth-A'), 'DECLINED');
  assert.equal(auths.activeHolds('ACC-001'), 0n);
  assert.equal(auths.available('ACC-001', 2), 25000n);
  assert.equal(auths.history('Auth-A').length, 1);
});

test('active holds count against the next authorization', () => {
  const { auths } = setup();
  auths.authorize(AUTH_A); // 50.00 left
  const second = auths.authorize({ ...AUTH_A, authId: 'Auth-C', ref: 'X1', amount: 5001n });
  assert.equal(second.type, 'DECLINED');
});

test('authorize rejects a duplicate authorization id, a wrong currency and a non-positive amount', () => {
  const { auths } = setup();
  auths.authorize(AUTH_A);
  assert.throws(() => auths.authorize({ ...AUTH_A, ref: 'X1' }));
  assert.throws(() => auths.authorize({ ...AUTH_A, authId: 'Auth-C', ref: 'X2', currency: 'BHD' }));
  assert.throws(() => auths.authorize({ ...AUTH_A, authId: 'Auth-D', ref: 'X3', amount: 0n }));
  assert.throws(() => auths.authorize({ ...AUTH_A, authId: 'Auth-E', ref: 'X4', accountId: 'ACC-999' }));
});

test('status of an authorization id never seen is UNKNOWN', () => {
  const { auths } = setup();
  assert.equal(auths.status('Auth-Z'), 'UNKNOWN');
  assert.deepEqual(auths.history('Auth-Z'), []);
});

test('E5: Auth-A settles for 185.00 — the actual amount is debited and the whole 200.00 hold is released', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  const result = auths.settle(SETTLE_A);
  assert.equal(result.exception, undefined); // criterion 3: accepted, no exception
  assert.equal(result.entry.kind, 'SETTLEMENT');
  assert.equal(result.entry.amount, -18500n);
  assert.equal(auths.status('Auth-A'), 'SETTLED');
  assert.equal(auths.activeHolds('ACC-001'), 0n); // the unused 15.00 is released too
  assert.equal(ledger.balance('ACC-001', 4), 46500n); // 650.00 - 185.00
  assert.equal(auths.available('ACC-001', 4), 46500n);
});

test('the authorization log is append-only: settling adds a record, it does not edit the approval', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  auths.settle(SETTLE_A);
  const history = auths.history('Auth-A');
  assert.deepEqual(history.map((r) => r.type), ['APPROVED', 'SETTLED']);
  assert.equal(history[0]!.amount, 20000n); // the hold as approved
  assert.equal(history[1]!.amount, 18500n); // the amount actually settled
  assert.ok(history.every((r) => Object.isFrozen(r)));
});

test('E6: a settlement with no authorization is posted AND reported (criterion 4 refused)', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  auths.settle(SETTLE_A);
  const result = auths.settle(SETTLE_Z);
  assert.equal(result.exception, 'NO_AUTHORIZATION');
  assert.equal(result.entry.amount, -18000n); // the funds did leave
  assert.equal(ledger.balance('ACC-001', 4), 28500n); // 465.00 - 180.00
  assert.equal(auths.status('Auth-Z'), 'SETTLED_WITHOUT_AUTH');
});

test('a settlement above the hold is posted in full and reported', () => {
  // Not in the event stream (see AMBIGUITIES.md): tips, fuel, FX differences.
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  const result = auths.settle({ ...SETTLE_A, amount: 21000n });
  assert.equal(result.exception, 'SETTLED_ABOVE_HOLD');
  assert.equal(result.entry.amount, -21000n);
  assert.equal(auths.status('Auth-A'), 'SETTLED');
  assert.equal(auths.activeHolds('ACC-001'), 0n);
});

test('a settlement against a declined authorization is posted and reported', () => {
  const { ledger, auths } = setup();
  auths.authorize({ ...AUTH_A, amount: 25001n }); // declined
  const result = auths.settle({ ...SETTLE_A, amount: 25001n });
  assert.equal(result.exception, 'AUTHORIZATION_DECLINED');
  assert.equal(ledger.balance('ACC-001', 4), -1n); // posted even though it overdraws
});

test('a second settlement against the same authorization is posted and reported', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  auths.settle(SETTLE_A);
  const result = auths.settle({ ...SETTLE_A, ref: 'X1' });
  assert.equal(result.exception, 'AUTHORIZATION_ALREADY_SETTLED');
  assert.equal(ledger.balance('ACC-001', 4), 28000n); // 650.00 - 185.00 - 185.00
  assert.equal(auths.status('Auth-A'), 'SETTLED');
});

test('settle rejects only what the ledger itself rejects (replayed ref, wrong currency)', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  auths.settle(SETTLE_A);
  assert.throws(() => auths.settle(SETTLE_A)); // same ref E5: a replay, not a new settlement
  assert.throws(() => auths.settle({ ...SETTLE_Z, currency: 'BHD' }));
  // A rejected settlement leaves no trace in either log.
  assert.equal(ledger.entries('ACC-001').length, 4);
  assert.equal(auths.status('Auth-Z'), 'UNKNOWN');
});

test('E8: Auth-B is declined because E7 was booked first — ledger -335.00, available -425.00 after the hold', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  auths.settle(SETTLE_A);
  auths.settle(SETTLE_Z);
  ledger.post(E7);
  assert.equal(auths.available('ACC-001', 5), -33500n);
  assert.equal(auths.authorize(AUTH_B).type, 'DECLINED');
  assert.equal(auths.activeHolds('ACC-001'), 0n);
});

test('criterion 5 holds when Auth-B is approved: without E7 the hold lowers available, not ledger', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  auths.settle(SETTLE_A);
  auths.settle(SETTLE_Z);
  assert.equal(auths.authorize(AUTH_B).type, 'APPROVED');
  assert.equal(ledger.balance('ACC-001', 5), 28500n);
  assert.equal(auths.available('ACC-001', 5), 19500n);
});

test('criterion 6 refused: reversing E7 does not un-decline Auth-B', () => {
  const { ledger, auths } = setup();
  auths.authorize(AUTH_A);
  ledger.post(E4);
  auths.settle(SETTLE_A);
  auths.settle(SETTLE_Z);
  ledger.post(E7);
  auths.authorize(AUTH_B);
  ledger.reverse({ originalRef: 'E7', ref: 'E9', bookedDay: 6, valueDate: 2 });
  // The balance is back; the decision is not. The customer's payment failed on Day 5.
  assert.equal(ledger.balance('ACC-001', 5), 28500n);
  assert.equal(auths.status('Auth-B'), 'DECLINED');
});
