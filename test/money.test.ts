// Step 1 — money.
// Spec rule: AED has 2 decimal places, BHD has 3; amounts are stored and
// rounded to their own precision.
// Decision: every amount is a bigint in the currency's minor unit (fils).
// Never a number: 0.1 + 0.2 !== 0.3 in floating point, and a ledger cannot
// lose a single fil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatAmount, splitEqually, roundHalfEven } from '../src/money.ts';

test('parseAmount converts text to the currency minor unit', () => {
  assert.equal(parseAmount('AED', '1,200.00'), 120000n);
  assert.equal(parseAmount('AED', '950.00'), 95000n);
  assert.equal(parseAmount('AED', '25'), 2500n);
  assert.equal(parseAmount('AED', '0.5'), 50n);
  assert.equal(parseAmount('BHD', '10.000'), 10000n);
});

test('parseAmount rejects excess precision instead of silently rounding', () => {
  // Rounding the input would hide a mistake made by whoever sent the event.
  assert.throws(() => parseAmount('AED', '1.005'));
  assert.throws(() => parseAmount('BHD', '1.0005'));
});

test('parseAmount rejects garbage and a negative sign (direction comes from the event type)', () => {
  assert.throws(() => parseAmount('AED', ''));
  assert.throws(() => parseAmount('AED', 'abc'));
  assert.throws(() => parseAmount('AED', '-1.00'));
});

test('formatAmount prints at currency precision, signed, no thousands separator', () => {
  assert.equal(formatAmount('AED', 120000n), '1200.00');
  assert.equal(formatAmount('AED', -37000n), '-370.00');
  assert.equal(formatAmount('AED', -5n), '-0.05');
  assert.equal(formatAmount('AED', 0n), '0.00');
  assert.equal(formatAmount('BHD', 4n), '0.004');
  assert.equal(formatAmount('BHD', 10008n), '10.008');
});

test('splitEqually: E10 — BHD 10.000 in 3 instalments sums to exactly 10.000', () => {
  // Criterion 7 (rejected) demands 3 x 3.334 = 10.002, creating 2 fils from nothing.
  // Chosen convention: the remainder goes to the LAST instalments.
  const parts = splitEqually(10000n, 3);
  assert.deepEqual(parts, [3333n, 3333n, 3334n]);
  assert.equal(parts.reduce((a, b) => a + b, 0n), 10000n);
});

test('splitEqually: a remainder above 1 is spread one unit per instalment', () => {
  assert.deepEqual(splitEqually(10001n, 3), [3333n, 3334n, 3334n]);
  assert.deepEqual(splitEqually(9n, 3), [3n, 3n, 3n]);
  assert.deepEqual(splitEqually(2n, 3), [0n, 1n, 1n]);
});

test('splitEqually rejects meaningless input', () => {
  assert.throws(() => splitEqually(10000n, 0));
  assert.throws(() => splitEqually(10000n, 1.5));
  assert.throws(() => splitEqually(-1n, 3));
});

test('roundHalfEven rounds a fraction (numerator/denominator) to an integer', () => {
  // Real use: daily interest = balance in fils x 4 / 10000 (0.04%).
  // AED 285.00 -> 28500 x 4 = 114000 / 10000 = 11.4 fils -> 11.
  assert.equal(roundHalfEven(114000n, 10000n), 11n);
  assert.equal(roundHalfEven(26n, 10n), 3n);
  assert.equal(roundHalfEven(0n, 7n), 0n);
});

test('roundHalfEven: a tie goes to the nearest even integer', () => {
  assert.equal(roundHalfEven(5n, 10n), 0n); // 0.5 -> 0
  assert.equal(roundHalfEven(15n, 10n), 2n); // 1.5 -> 2
  assert.equal(roundHalfEven(25n, 10n), 2n); // 2.5 -> 2
  assert.equal(roundHalfEven(35n, 10n), 4n); // 3.5 -> 4
});

test('roundHalfEven rejects a negative numerator and a non-positive denominator', () => {
  // Interest only exists on positive balances, so a negative here is a caller bug.
  assert.throws(() => roundHalfEven(-1n, 10n));
  assert.throws(() => roundHalfEven(1n, 0n));
});
