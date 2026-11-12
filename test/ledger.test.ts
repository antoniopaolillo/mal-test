// Step 2 — the append-only ledger and balances by value date.
// Spec rules: the ledger is append-only (no record is ever mutated or deleted),
// and a day's closing ledger balance is the sum of all entries with
// value_date <= that day.
// Decision: every entry carries TWO days. bookedDay is when the ledger learned
// about it; valueDate is the day it counts for. Keeping both lets us answer
// "what was Day 2's balance as we knew it at the end of Day 4?" without ever
// rewriting history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger.ts';

// ACC-001 entries up to the end of Day 4, signed in fils (credit +, debit -).
// E5 and E6 appear here as plain debits; the authorization logic is step 3.
function ledgerAtEndOfDay4(): Ledger {
  const ledger = new Ledger();
  ledger.openAccount('ACC-001', 'AED');
  ledger.post({ accountId: 'ACC-001', ref: 'E1', kind: 'CREDIT', currency: 'AED', amount: 120000n, bookedDay: 1, valueDate: 1 });
  ledger.post({ accountId: 'ACC-001', ref: 'E2', kind: 'DEBIT', currency: 'AED', amount: -95000n, bookedDay: 1, valueDate: 1 });
  ledger.post({ accountId: 'ACC-001', ref: 'E4', kind: 'CREDIT', currency: 'AED', amount: 40000n, bookedDay: 3, valueDate: 3 });
  ledger.post({ accountId: 'ACC-001', ref: 'E5', kind: 'SETTLEMENT', currency: 'AED', amount: -18500n, bookedDay: 4, valueDate: 4 });
  ledger.post({ accountId: 'ACC-001', ref: 'E6', kind: 'SETTLEMENT', currency: 'AED', amount: -18000n, bookedDay: 4, valueDate: 4 });
  return ledger;
}

const E7 = { accountId: 'ACC-001', ref: 'E7', kind: 'DEBIT', currency: 'AED', amount: -62000n, bookedDay: 5, valueDate: 2 } as const;

test('a new account has a zero balance on every day', () => {
  const ledger = new Ledger();
  ledger.openAccount('ACC-002', 'BHD');
  assert.equal(ledger.balance('ACC-002', 1), 0n);
  assert.equal(ledger.balance('ACC-002', 6), 0n);
  assert.deepEqual(ledger.entries('ACC-002'), []);
});

test('balance(day) sums every entry with valueDate <= day', () => {
  const ledger = ledgerAtEndOfDay4();
  assert.equal(ledger.balance('ACC-001', 1), 25000n); // 1200.00 - 950.00
  assert.equal(ledger.balance('ACC-001', 2), 25000n); // nothing value-dated Day 2 yet
  assert.equal(ledger.balance('ACC-001', 3), 65000n); // + 400.00
  assert.equal(ledger.balance('ACC-001', 4), 28500n); // - 185.00 - 180.00
});

test('a back-valued entry changes past closing balances (criterion 1: Day 2 = -370.00)', () => {
  const ledger = ledgerAtEndOfDay4();
  ledger.post(E7); // booked Day 5, value-dated Day 2
  assert.equal(ledger.balance('ACC-001', 1), 25000n); // before the value date: untouched
  assert.equal(ledger.balance('ACC-001', 2), -37000n); // 250.00 - 620.00
  assert.equal(ledger.balance('ACC-001', 3), 3000n);
  assert.equal(ledger.balance('ACC-001', 4), -33500n);
  assert.equal(ledger.balance('ACC-001', 5), -33500n);
});

test('balance(day, knownAt) answers as of what the ledger knew at the end of knownAt', () => {
  // Same value date, two different answers, both true: that is why entries
  // keep bookedDay. Nothing was rewritten to get from one answer to the other.
  const ledger = ledgerAtEndOfDay4();
  ledger.post(E7);
  assert.equal(ledger.balance('ACC-001', 2, 4), 25000n); // E7 not yet booked
  assert.equal(ledger.balance('ACC-001', 2, 5), -37000n); // E7 booked on Day 5
});

test('post returns the stored entry with an increasing sequence number', () => {
  const ledger = new Ledger();
  ledger.openAccount('ACC-001', 'AED');
  const a = ledger.post({ accountId: 'ACC-001', ref: 'E1', kind: 'CREDIT', currency: 'AED', amount: 120000n, bookedDay: 1, valueDate: 1 });
  const b = ledger.post({ accountId: 'ACC-001', ref: 'E2', kind: 'DEBIT', currency: 'AED', amount: -95000n, bookedDay: 1, valueDate: 1 });
  assert.equal(a.ref, 'E1');
  assert.equal(a.amount, 120000n);
  assert.ok(b.seq > a.seq);
});

test('append-only: stored entries cannot be mutated', () => {
  const ledger = ledgerAtEndOfDay4();
  const first = ledger.entries('ACC-001')[0]!;
  assert.ok(Object.isFrozen(first));
  // In an ES module (strict mode) writing to a frozen object throws.
  assert.throws(() => { (first as { amount: bigint }).amount = 1n; });
  assert.equal(ledger.balance('ACC-001', 1), 25000n);
});

test('append-only: the list handed out is not the ledger internal list', () => {
  const ledger = ledgerAtEndOfDay4();
  const copy = ledger.entries('ACC-001') as unknown[];
  try { copy.length = 0; } catch { /* a frozen list is an equally valid defence */ }
  assert.equal(ledger.entries('ACC-001').length, 5);
  assert.equal(ledger.balance('ACC-001', 4), 28500n);
});

test('post rejects an unknown account, a wrong currency, a zero amount and a duplicate ref', () => {
  const ledger = ledgerAtEndOfDay4();
  const ok = { accountId: 'ACC-001', ref: 'X1', kind: 'CREDIT', currency: 'AED', amount: 100n, bookedDay: 4, valueDate: 4 } as const;
  assert.throws(() => ledger.post({ ...ok, accountId: 'ACC-999' }));
  // No FX in scope: an AED account never receives a BHD amount.
  assert.throws(() => ledger.post({ ...ok, currency: 'BHD' }));
  assert.throws(() => ledger.post({ ...ok, amount: 0n }));
  // Idempotency: replaying the same event twice must not post it twice.
  assert.throws(() => ledger.post({ ...ok, ref: 'E1' }));
  // None of the rejected attempts left a trace.
  assert.equal(ledger.entries('ACC-001').length, 5);
});

test('openAccount rejects opening the same account twice', () => {
  const ledger = new Ledger();
  ledger.openAccount('ACC-001', 'AED');
  assert.throws(() => ledger.openAccount('ACC-001', 'AED'));
});

test('reverse appends an opposite entry linked to the original (E9 reverses E7)', () => {
  const ledger = ledgerAtEndOfDay4();
  ledger.post(E7);
  const e9 = ledger.reverse({ originalRef: 'E7', ref: 'E9', bookedDay: 6, valueDate: 2 });
  assert.equal(e9.kind, 'REVERSAL');
  assert.equal(e9.amount, 62000n);
  assert.equal(e9.reversesRef, 'E7');
  assert.equal(e9.accountId, 'ACC-001');
  // Balances by value date are back to where they were...
  assert.equal(ledger.balance('ACC-001', 2), 25000n);
  assert.equal(ledger.balance('ACC-001', 5), 28500n);
  // ...but the record is not: E7 is still there, untouched, next to E9.
  const refs = ledger.entries('ACC-001').map((e) => e.ref);
  assert.deepEqual(refs, ['E1', 'E2', 'E4', 'E5', 'E6', 'E7', 'E9']);
  // And the past view is preserved: at the end of Day 5, Day 2 was still -370.00.
  assert.equal(ledger.balance('ACC-001', 2, 5), -37000n);
});

test('reverse rejects an unknown original, a second reversal, and reversing a reversal', () => {
  const ledger = ledgerAtEndOfDay4();
  ledger.post(E7);
  assert.throws(() => ledger.reverse({ originalRef: 'E99', ref: 'R0', bookedDay: 6, valueDate: 2 }));
  ledger.reverse({ originalRef: 'E7', ref: 'E9', bookedDay: 6, valueDate: 2 });
  assert.throws(() => ledger.reverse({ originalRef: 'E7', ref: 'R1', bookedDay: 6, valueDate: 2 }));
  assert.throws(() => ledger.reverse({ originalRef: 'E9', ref: 'R2', bookedDay: 6, valueDate: 2 }));
  assert.equal(ledger.entries('ACC-001').length, 7);
});
