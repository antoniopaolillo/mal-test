// THIS TEST FAILS ON PURPOSE. It is the "one failing test against your own
// design" the brief asks for. Everything else in the suite is green.
//
// What it reveals
// ---------------
// Authorizations looks an authorization up by its id alone. It never checks
// that the settlement names the same account the hold was placed on. The
// design silently assumes that an authorization id is globally unique AND
// that whoever sends the settlement always sends the right account.
//
// So a settlement for Auth-A that names ACC-003 is treated as a normal,
// fully backed settlement:
//   1. ACC-003, which never authorized anything, is debited with no exception;
//   2. Auth-A is marked SETTLED;
//   3. the AED 200.00 hold on ACC-001 is released, although ACC-001 was never
//      debited: its available balance jumps from 50.00 back to 250.00 while
//      the real card transaction may still be on its way.
//
// Why it is left failing instead of fixed
// ---------------------------------------
// The honest fix is not one `if`. The status of an authorization is derived
// from "the last record with this authId"; making it account-aware means
// changing the key of the whole authorization log to (accountId, authId) and
// deciding what a cross-account settlement IS: an unbacked settlement on the
// named account (most likely: post + NO_AUTHORIZATION), with the original
// hold left untouched until it is settled properly or expires. Expiry does
// not exist in this model either (see the architecture document). No event in
// the brief exercises this path, so the gap is documented here, not papered over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.ts';
import { Authorizations } from '../src/authorizations.ts';

test('KNOWN GAP (fails on purpose): a settlement naming another account must not release the hold', () => {
  const ledger = new Ledger();
  const auths = new Authorizations(ledger);
  ledger.openAccount('ACC-001', 'AED');
  ledger.openAccount('ACC-003', 'AED');
  ledger.post({ accountId: 'ACC-001', ref: 'C1', kind: 'CREDIT', currency: 'AED', amount: 25000n, bookedDay: 1, valueDate: 1 });
  ledger.post({ accountId: 'ACC-003', ref: 'C2', kind: 'CREDIT', currency: 'AED', amount: 10000n, bookedDay: 1, valueDate: 1 });

  // Hold of 200.00 on ACC-001.
  auths.authorize({ accountId: 'ACC-001', authId: 'Auth-A', ref: 'A1', currency: 'AED', amount: 20000n, day: 2 });
  assert.equal(auths.available('ACC-001', 2), 5000n);

  // The settlement for Auth-A arrives naming ACC-003.
  const result = auths.settle({ accountId: 'ACC-003', authId: 'Auth-A', ref: 'S1', currency: 'AED', amount: 5000n, bookedDay: 3, valueDate: 3 });

  // Expected by a correct design: ACC-003 has no authorization called Auth-A,
  // so this is an unbacked settlement and must be reported as one.
  // ACTUAL: `exception` is undefined. This is the assertion that fails.
  assert.equal(result.exception, 'NO_AUTHORIZATION');

  // Expected: the hold on ACC-001 is untouched.
  // ACTUAL (never reached): activeHolds is 0n and available is back to 25000n.
  assert.equal(auths.activeHolds('ACC-001'), 20000n);
  assert.equal(auths.available('ACC-001', 3), 5000n);
});
