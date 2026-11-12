import type { Currency } from './money.ts'

// The kind is only a label; the sign of the amount is what moves the balance.
export type EntryKind = 'CREDIT' | 'DEBIT' | 'SETTLEMENT' | 'REVERSAL'

export interface Entry {
  readonly seq: number
  readonly accountId: string
  readonly ref: string
  readonly kind: EntryKind
  readonly currency: Currency
  /** Signed, in the currency minor unit: credit positive, debit negative. */
  readonly amount: bigint
  /** The day the ledger learned about the entry. */
  readonly bookedDay: number
  /** The day the entry counts for. */
  readonly valueDate: number
  /** Present only on a reversal: the ref of the entry it cancels. */
  readonly reversesRef?: string
}

export type PostInput = Omit<Entry, 'seq' | 'reversesRef'>

export interface ReverseInput {
  originalRef: string
  ref: string
  bookedDay: number
  valueDate: number
}

export class Ledger {
  // Account currency by account id.
  readonly #accounts = new Map<string, Currency>()
  // Every entry, in arrival order. Only ever pushed to.
  readonly #entries: Entry[] = []
  // Index by ref: uniqueness check (idempotent replay) and lookup for reverse.
  readonly #byRef = new Map<string, Entry>()
  // Refs that already have a reversal pointing at them.
  readonly #reversed = new Set<string>()

  openAccount(accountId: string, currency: Currency): void {
    if (this.#accounts.has(accountId)) {
      throw new Error(`Account already exists: ${accountId}`)
    }
    this.#accounts.set(accountId, currency)
  }

  post(input: PostInput): Entry {
    return this.#append(input)
  }

  reverse(input: ReverseInput): Entry {
    const original = this.#byRef.get(input.originalRef)
    if (original === undefined) {
      throw new Error(`Unknown entry: ${input.originalRef}`)
    }
    if (original.reversesRef !== undefined) {
      throw new Error(`Cannot reverse a reversal: ${input.originalRef}`)
    }
    if (this.#reversed.has(original.ref)) {
      throw new Error(`Entry already reversed: ${input.originalRef}`)
    }
    const entry = this.#append({
      accountId: original.accountId,
      ref: input.ref,
      kind: 'REVERSAL',
      currency: original.currency,
      amount: -original.amount,
      bookedDay: input.bookedDay,
      valueDate: input.valueDate,
      reversesRef: original.ref,
    })
    // Marked only after the append succeeded, so a rejected reversal leaves no trace.
    this.#reversed.add(original.ref)
    return entry
  }

  entries(accountId: string): readonly Entry[] {
    this.#requireAccount(accountId)
    // A fresh array each call: the caller never holds the internal list.
    return this.#entries.filter((e) => e.accountId === accountId)
  }

  balance(accountId: string, day: number, knownAt?: number): bigint {
    this.#requireAccount(accountId)
    let sum = 0n
    for (const e of this.#entries) {
      if (e.accountId !== accountId) continue
      if (e.valueDate > day) continue
      if (knownAt !== undefined && e.bookedDay > knownAt) continue
      sum += e.amount
    }
    return sum
  }

  // Every validation runs before anything is stored: an entry is either
  // appended whole or not at all.
  #append(input: PostInput & { reversesRef?: string }): Entry {
    const accountCurrency = this.#requireAccount(input.accountId)
    if (input.currency !== accountCurrency) {
      throw new Error(
        `Currency mismatch on ${input.accountId}: account is ${accountCurrency}, entry is ${input.currency}`,
      )
    }
    if (input.amount === 0n) {
      throw new Error(`Zero amount: ${input.ref}`)
    }
    if (this.#byRef.has(input.ref)) {
      throw new Error(`Duplicate ref: ${input.ref}`)
    }
    // Copy field by field (never keep the caller's object) and freeze.
    const entry: Entry = Object.freeze({
      seq: this.#entries.length + 1,
      accountId: input.accountId,
      ref: input.ref,
      kind: input.kind,
      currency: input.currency,
      amount: input.amount,
      bookedDay: input.bookedDay,
      valueDate: input.valueDate,
      ...(input.reversesRef !== undefined ? { reversesRef: input.reversesRef } : {}),
    })
    this.#entries.push(entry)
    this.#byRef.set(entry.ref, entry)
    return entry
  }

  #requireAccount(accountId: string): Currency {
    const currency = this.#accounts.get(accountId)
    if (currency === undefined) {
      throw new Error(`Unknown account: ${accountId}`)
    }
    return currency
  }
}
