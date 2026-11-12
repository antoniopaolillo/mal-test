import { roundHalfEven } from './money.ts'
import type { Currency } from './money.ts'
import type { Entry, Ledger } from './ledger.ts'

/** Overdraft fee: AED 25.00, once per day per account. Defined in AED only. */
export const OVERDRAFT_FEE_CURRENCY: Currency = 'AED'
export const OVERDRAFT_FEE_AMOUNT = 2500n

/** Daily interest rate on positive closing balances: 0.04% = 4 / 10000. */
export const INTEREST_RATE_NUMERATOR = 4n
export const INTEREST_RATE_DENOMINATOR = 10000n

export type DayCloseError = 'OVERDRAFT_FEE_NOT_CONFIGURED'

// One record per accrual or adjustment. Interest lives here, outside the
// ledger, until it is capitalized. Append-only: a correction is a new record.
export interface Accrual {
  readonly seq: number
  readonly accountId: string
  /** The day the interest was earned for. */
  readonly forDay: number
  /** The close that produced the record. */
  readonly bookedDay: number
  /** Signed, in the currency minor unit: negative takes back an earlier accrual. */
  readonly amount: bigint
}

export interface DayCloseResult {
  accountId: string
  day: number
  /** Ledger balance of `day` after this close's fees and reversals. */
  closingBalance: bigint
  feesAssessed: Entry[]
  feesReversed: Entry[]
  /** Only the accrual records created by this close. */
  accruals: Accrual[]
  /** Net of every accrual record of the account so far. */
  accruedTotal: bigint
  errors: DayCloseError[]
}

export class EndOfDay {
  readonly #ledger: Ledger
  // Every accrual record, in arrival order. Only ever pushed to.
  readonly #accruals: Accrual[] = []
  // Accounts whose accruals were already capitalized.
  readonly #capitalized = new Set<string>()

  constructor(ledger: Ledger) {
    this.#ledger = ledger
  }

  close(accountId: string, day: number): DayCloseResult {
    // Throws for an unknown account before anything is written.
    const currency = this.#ledger.currencyOf(accountId)
    // Fees first: they are ledger entries, so they change the balances that
    // the interest pass reads.
    const fees = this.#adjustFees(accountId, currency, day)
    const accruals = this.#adjustAccruals(accountId, day)
    return {
      accountId,
      day,
      closingBalance: this.#ledger.balance(accountId, day),
      feesAssessed: fees.assessed,
      feesReversed: fees.reversed,
      accruals,
      accruedTotal: this.#accruedTotal(accountId),
      errors: fees.errors,
    }
  }

  accruals(accountId: string): readonly Accrual[] {
    this.#ledger.currencyOf(accountId) // throws for an unknown account
    return this.#accruals.filter((a) => a.accountId === accountId)
  }

  capitalize(accountId: string, day: number): Entry | undefined {
    const currency = this.#ledger.currencyOf(accountId)
    if (this.#capitalized.has(accountId)) {
      throw new Error(`Interest already capitalized: ${accountId}`)
    }
    const total = this.#accruedTotal(accountId)
    if (total === 0n) return undefined
    // The credit is the sum of the daily records, so the spec invariant
    // (daily accruals sum exactly to the capitalized total) holds by construction.
    const entry = this.#ledger.post({
      accountId,
      ref: `INTEREST:${accountId}:D${day}`,
      kind: 'INTEREST',
      currency,
      amount: total,
      bookedDay: day,
      valueDate: day,
    })
    // Marked only after the post succeeded.
    this.#capitalized.add(accountId)
    return entry
  }

  // Part 1. Re-evaluates every day from 1 to `day`, in order: a back-valued
  // entry can change a day that was already closed, and the fee of day d
  // changes the balance of day d + 1.
  #adjustFees(
    accountId: string,
    currency: Currency,
    day: number,
  ): { assessed: Entry[]; reversed: Entry[]; errors: DayCloseError[] } {
    const assessed: Entry[] = []
    const reversed: Entry[] = []
    const errors: DayCloseError[] = []

    for (let d = 1; d <= day; d++) {
      // Re-read on every day: the list grows as fees and reversals are posted.
      const entries = this.#ledger.entries(accountId)
      const reversedRefs = new Set(entries.map((e) => e.reversesRef))
      const feesOfDay = entries.filter((e) => e.kind === 'FEE' && e.valueDate === d)
      const activeFee = feesOfDay.find((e) => !reversedRefs.has(e.ref))

      // The day's balance without its own fee; otherwise the fee would justify itself.
      const balance = this.#ledger.balance(accountId, d) - (activeFee?.amount ?? 0n)

      if (balance < 0n && activeFee === undefined) {
        if (currency !== OVERDRAFT_FEE_CURRENCY) {
          // The spec gives the fee in AED and no FX rate: report, do not guess.
          if (!errors.includes('OVERDRAFT_FEE_NOT_CONFIGURED')) {
            errors.push('OVERDRAFT_FEE_NOT_CONFIGURED')
          }
          continue
        }
        assessed.push(
          this.#ledger.post({
            accountId,
            // The counter keeps the ref unique if the day is charged, reversed and charged again.
            ref: `FEE:${accountId}:D${d}:${feesOfDay.length + 1}`,
            kind: 'FEE',
            currency,
            amount: -OVERDRAFT_FEE_AMOUNT,
            bookedDay: day,
            valueDate: d,
          }),
        )
      } else if (balance >= 0n && activeFee !== undefined) {
        reversed.push(
          this.#ledger.reverse({
            originalRef: activeFee.ref,
            ref: `REV:${activeFee.ref}`,
            bookedDay: day,
            valueDate: d,
          }),
        )
      }
    }
    return { assessed, reversed, errors }
  }

  // Part 2. Recomputes each day's interest from the balances as they stand
  // now and records only the difference to what is already on the log.
  #adjustAccruals(accountId: string, day: number): Accrual[] {
    const created: Accrual[] = []
    // Exact running total in 1/10000 of a minor unit: never rounded.
    let cumulative = 0n
    let previousRounded = 0n

    for (let d = 1; d <= day; d++) {
      const balance = this.#ledger.balance(accountId, d)
      if (balance > 0n) cumulative += balance * INTEREST_RATE_NUMERATOR

      // Rounding the running total, not each day, carries the residual forward.
      const rounded = roundHalfEven(cumulative, INTEREST_RATE_DENOMINATOR)
      const interestOfDay = rounded - previousRounded
      previousRounded = rounded

      const recorded = this.#accruedForDay(accountId, d)
      if (interestOfDay !== recorded) {
        const record: Accrual = Object.freeze({
          seq: this.#accruals.length + 1,
          accountId,
          forDay: d,
          bookedDay: day,
          amount: interestOfDay - recorded,
        })
        this.#accruals.push(record)
        created.push(record)
      }
    }
    return created
  }

  #accruedForDay(accountId: string, forDay: number): bigint {
    let sum = 0n
    for (const a of this.#accruals) {
      if (a.accountId === accountId && a.forDay === forDay) sum += a.amount
    }
    return sum
  }

  #accruedTotal(accountId: string): bigint {
    let sum = 0n
    for (const a of this.#accruals) {
      if (a.accountId === accountId) sum += a.amount
    }
    return sum
  }
}
