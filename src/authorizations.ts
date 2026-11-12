import type { Currency } from './money.ts'
import type { Entry, Ledger } from './ledger.ts'

// One record per thing that happened to an authorization. The log is
// append-only: a settlement adds a record, it never edits the approval.
export type AuthRecordType = 'APPROVED' | 'DECLINED' | 'SETTLED' | 'SETTLED_WITHOUT_AUTH'

export type AuthStatus = 'ACTIVE' | 'DECLINED' | 'SETTLED' | 'SETTLED_WITHOUT_AUTH' | 'UNKNOWN'

export type SettlementException =
  | 'NO_AUTHORIZATION'
  | 'AUTHORIZATION_DECLINED'
  | 'AUTHORIZATION_ALREADY_SETTLED'
  | 'SETTLED_ABOVE_HOLD'

export interface AuthRecord {
  readonly seq: number
  readonly type: AuthRecordType
  readonly authId: string
  readonly accountId: string
  readonly ref: string
  readonly currency: Currency
  /** Always positive: the hold requested, or the amount actually settled. */
  readonly amount: bigint
  /** The day the record was made (for a settlement, its bookedDay). */
  readonly day: number
  /** Present only on a settlement that was posted without a usable hold behind it. */
  readonly exception?: SettlementException
}

export interface AuthorizeInput {
  accountId: string
  authId: string
  ref: string
  currency: Currency
  amount: bigint
  day: number
}

export interface SettleInput {
  accountId: string
  authId: string
  ref: string
  currency: Currency
  amount: bigint
  bookedDay: number
  valueDate: number
}

export interface SettleResult {
  entry: Entry
  exception?: SettlementException
}

// The status is whatever the last record of the authorization says.
const STATUS_AFTER: Record<AuthRecordType, AuthStatus> = {
  APPROVED: 'ACTIVE',
  DECLINED: 'DECLINED',
  SETTLED: 'SETTLED',
  SETTLED_WITHOUT_AUTH: 'SETTLED_WITHOUT_AUTH',
}

export class Authorizations {
  readonly #ledger: Ledger
  // Every record, in arrival order. Only ever pushed to.
  readonly #records: AuthRecord[] = []

  constructor(ledger: Ledger) {
    this.#ledger = ledger
  }

  authorize(input: AuthorizeInput): AuthRecord {
    if (this.status(input.authId) !== 'UNKNOWN') {
      throw new Error(`Authorization id already used: ${input.authId}`)
    }
    // Throws for an unknown account.
    const accountCurrency = this.#ledger.currencyOf(input.accountId)
    if (input.currency !== accountCurrency) {
      throw new Error(
        `Currency mismatch on ${input.accountId}: account is ${accountCurrency}, authorization is ${input.currency}`,
      )
    }
    if (input.amount <= 0n) {
      throw new Error(`Authorization amount must be positive: ${input.authId}`)
    }
    // Spec rule: approve only if available stays at or above zero after the hold.
    const availableAfter = this.available(input.accountId, input.day) - input.amount
    return this.#append({
      type: availableAfter >= 0n ? 'APPROVED' : 'DECLINED',
      authId: input.authId,
      accountId: input.accountId,
      ref: input.ref,
      currency: input.currency,
      amount: input.amount,
      day: input.day,
    })
  }

  settle(input: SettleInput): SettleResult {
    if (input.amount <= 0n) {
      throw new Error(`Settlement amount must be positive: ${input.ref}`)
    }
    // Captured BEFORE anything is written: after the new record it will have changed.
    const statusBefore = this.status(input.authId)
    const hold = this.#approvedAmount(input.authId)

    // Ledger first. If it rejects (replayed ref, wrong currency, unknown
    // account) the error propagates before the authorization log is touched.
    const entry = this.#ledger.post({
      accountId: input.accountId,
      ref: input.ref,
      kind: 'SETTLEMENT',
      currency: input.currency,
      amount: -input.amount,
      bookedDay: input.bookedDay,
      valueDate: input.valueDate,
    })

    const exception = settlementException(statusBefore, input.amount, hold)
    // A settlement counts as backed by the authorization only if one was ever approved.
    const backed = statusBefore === 'ACTIVE' || statusBefore === 'SETTLED'
    this.#append({
      type: backed ? 'SETTLED' : 'SETTLED_WITHOUT_AUTH',
      authId: input.authId,
      accountId: input.accountId,
      ref: input.ref,
      currency: input.currency,
      amount: input.amount,
      day: input.bookedDay,
      ...(exception !== undefined ? { exception } : {}),
    })
    return exception !== undefined ? { entry, exception } : { entry }
  }

  status(authId: string): AuthStatus {
    let status: AuthStatus = 'UNKNOWN'
    for (const r of this.#records) {
      if (r.authId === authId) status = STATUS_AFTER[r.type]
    }
    return status
  }

  activeHolds(accountId: string): bigint {
    this.#ledger.currencyOf(accountId) // throws for an unknown account
    let sum = 0n
    for (const r of this.#records) {
      if (r.accountId !== accountId || r.type !== 'APPROVED') continue
      // An approval is a hold only while nothing has settled against it.
      if (this.status(r.authId) === 'ACTIVE') sum += r.amount
    }
    return sum
  }

  available(accountId: string, day: number): bigint {
    return this.#ledger.balance(accountId, day) - this.activeHolds(accountId)
  }

  history(authId: string): readonly AuthRecord[] {
    // A fresh array of frozen records: the caller never holds the internal list.
    return this.#records.filter((r) => r.authId === authId)
  }

  #approvedAmount(authId: string): bigint | undefined {
    return this.#records.find((r) => r.authId === authId && r.type === 'APPROVED')?.amount
  }

  #append(record: Omit<AuthRecord, 'seq'>): AuthRecord {
    const stored: AuthRecord = Object.freeze({ seq: this.#records.length + 1, ...record })
    this.#records.push(stored)
    return stored
  }
}

function settlementException(
  statusBefore: AuthStatus,
  amount: bigint,
  hold: bigint | undefined,
): SettlementException | undefined {
  switch (statusBefore) {
    case 'UNKNOWN':
    case 'SETTLED_WITHOUT_AUTH':
      return 'NO_AUTHORIZATION'
    case 'DECLINED':
      return 'AUTHORIZATION_DECLINED'
    case 'SETTLED':
      return 'AUTHORIZATION_ALREADY_SETTLED'
    case 'ACTIVE':
      return hold !== undefined && amount > hold ? 'SETTLED_ABOVE_HOLD' : undefined
  }
}
