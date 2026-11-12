import { formatAmount, parseAmount, splitEqually } from './money.ts'
import type { Currency } from './money.ts'
import { Ledger } from './ledger.ts'
import { Authorizations } from './authorizations.ts'
import type { AuthStatus } from './authorizations.ts'
import { EndOfDay, OVERDRAFT_FEE_AMOUNT, OVERDRAFT_FEE_CURRENCY } from './endofday.ts'

interface EventBase {
  id: string
  /** The day the event arrives. */
  bookedDay: number
  accountId: string
  /** The day the event counts for. */
  valueDate: number
}

/** Amounts are text, as in the brief ('1,200.00'); parseAmount turns them into minor units. */
export type ReplayEvent =
  | (EventBase & { type: 'CREDIT' | 'DEBIT'; currency: Currency; amount: string; instalments?: number })
  | (EventBase & { type: 'AUTHORIZATION' | 'SETTLEMENT'; currency: Currency; amount: string; authId: string })
  | (EventBase & { type: 'REVERSAL'; reverses: string })

/** One row per account per day. */
export interface DayReport {
  day: number
  accountId: string
  currency: Currency
  /** Ledger balance at the close; on the last day it includes the capitalized interest. */
  closingBalance: bigint
  available: bigint
  /** Value dates charged / un-charged by this close, e.g. [2, 4, 5]. */
  feesAssessed: number[]
  feesReversed: number[]
  authorizations: Record<string, AuthStatus>
  accruedInterest: bigint
  /** Only on the last day, and only if a credit was posted. */
  interestCapitalized?: bigint
  errors: string[]
}

export interface ReplayReport {
  days: DayReport[]
}

const ACCOUNTS: ReadonlyArray<{ accountId: string; currency: Currency }> = [
  { accountId: 'ACC-001', currency: 'AED' },
  { accountId: 'ACC-002', currency: 'BHD' },
]

/** The replay covers Days 1 to 6; interest is capitalized at the end of Day 6. */
export const LAST_DAY = 6

/** The ten events, in the order the brief lists them. */
export const EVENTS: readonly ReplayEvent[] = [
  { id: 'E1', bookedDay: 1, type: 'CREDIT', accountId: 'ACC-001', currency: 'AED', amount: '1,200.00', valueDate: 1 },
  { id: 'E2', bookedDay: 1, type: 'DEBIT', accountId: 'ACC-001', currency: 'AED', amount: '950.00', valueDate: 1 },
  { id: 'E3', bookedDay: 2, type: 'AUTHORIZATION', accountId: 'ACC-001', currency: 'AED', amount: '200.00', authId: 'Auth-A', valueDate: 2 },
  { id: 'E4', bookedDay: 3, type: 'CREDIT', accountId: 'ACC-001', currency: 'AED', amount: '400.00', valueDate: 3 },
  { id: 'E5', bookedDay: 4, type: 'SETTLEMENT', accountId: 'ACC-001', currency: 'AED', amount: '185.00', authId: 'Auth-A', valueDate: 4 },
  { id: 'E6', bookedDay: 4, type: 'SETTLEMENT', accountId: 'ACC-001', currency: 'AED', amount: '180.00', authId: 'Auth-Z', valueDate: 4 },
  { id: 'E7', bookedDay: 5, type: 'DEBIT', accountId: 'ACC-001', currency: 'AED', amount: '620.00', valueDate: 2 },
  { id: 'E8', bookedDay: 5, type: 'AUTHORIZATION', accountId: 'ACC-001', currency: 'AED', amount: '90.00', authId: 'Auth-B', valueDate: 5 },
  { id: 'E9', bookedDay: 6, type: 'REVERSAL', accountId: 'ACC-001', reverses: 'E7', valueDate: 2 },
  { id: 'E10', bookedDay: 5, type: 'CREDIT', accountId: 'ACC-002', currency: 'BHD', amount: '10.000', instalments: 3, valueDate: 5 },
]

export function replay(events: readonly ReplayEvent[] = EVENTS): ReplayReport {
  const ledger = new Ledger()
  const auths = new Authorizations(ledger)
  const eod = new EndOfDay(ledger)

  const days: DayReport[] = []
  // Per account: the last day already closed (0 = none yet).
  const lastClosed = new Map<string, number>()
  // Per account: the authorization ids seen so far, in order of appearance.
  const authIds = new Map<string, string[]>()
  // Per account and day: the error list. A report row points at the SAME
  // array, so an error that arrives after the row was built still shows on it.
  const errorLists = new Map<string, string[]>()

  for (const { accountId, currency } of ACCOUNTS) {
    ledger.openAccount(accountId, currency)
    lastClosed.set(accountId, 0)
    authIds.set(accountId, [])
  }

  const errorsOf = (accountId: string, day: number): string[] => {
    const key = `${accountId}#${day}`
    let list = errorLists.get(key)
    if (list === undefined) {
      list = []
      errorLists.set(key, list)
    }
    return list
  }

  // Closing a day: fees and accruals, capitalization on the last day, then the report row.
  const closeDay = (accountId: string, day: number): void => {
    const result = eod.close(accountId, day)
    const capitalized = day === LAST_DAY ? eod.capitalize(accountId, day) : undefined
    const errors = errorsOf(accountId, day)
    for (const e of result.errors) errors.push(`CLOSE: ${e}`)

    const authorizations: Record<string, AuthStatus> = {}
    for (const authId of authIds.get(accountId) ?? []) authorizations[authId] = auths.status(authId)

    days.push({
      day,
      accountId,
      currency: ledger.currencyOf(accountId),
      // Read after capitalization, so the last day includes the interest credit.
      closingBalance: ledger.balance(accountId, day),
      available: auths.available(accountId, day),
      feesAssessed: result.feesAssessed.map((f) => f.valueDate),
      feesReversed: result.feesReversed.map((f) => f.valueDate),
      authorizations,
      accruedInterest: result.accruedTotal,
      ...(capitalized !== undefined ? { interestCapitalized: capitalized.amount } : {}),
      errors,
    })
    lastClosed.set(accountId, day)
  }

  const closeThrough = (accountId: string, day: number): void => {
    for (let d = (lastClosed.get(accountId) ?? 0) + 1; d <= day; d++) closeDay(accountId, d)
  }

  const noteAuthId = (accountId: string, authId: string): void => {
    const seen = authIds.get(accountId)
    if (seen !== undefined && !seen.includes(authId)) seen.push(authId)
  }

  const apply = (event: ReplayEvent, errors: string[]): void => {
    switch (event.type) {
      case 'CREDIT':
      case 'DEBIT': {
        const total = parseAmount(event.currency, event.amount)
        const sign = event.type === 'CREDIT' ? 1n : -1n
        const parts = splitEqually(total, event.instalments ?? 1)
        parts.forEach((part, i) => {
          ledger.post({
            accountId: event.accountId,
            // One instalment keeps the event id; several get E10/1, E10/2, ...
            ref: parts.length === 1 ? event.id : `${event.id}/${i + 1}`,
            kind: event.type,
            currency: event.currency,
            amount: sign * part,
            bookedDay: event.bookedDay,
            valueDate: event.valueDate,
          })
        })
        return
      }
      case 'AUTHORIZATION': {
        auths.authorize({
          accountId: event.accountId,
          authId: event.authId,
          ref: event.id,
          currency: event.currency,
          amount: parseAmount(event.currency, event.amount),
          day: event.bookedDay,
        })
        noteAuthId(event.accountId, event.authId)
        return
      }
      case 'SETTLEMENT': {
        const result = auths.settle({
          accountId: event.accountId,
          authId: event.authId,
          ref: event.id,
          currency: event.currency,
          amount: parseAmount(event.currency, event.amount),
          bookedDay: event.bookedDay,
          valueDate: event.valueDate,
        })
        noteAuthId(event.accountId, event.authId)
        // Posted AND reported: the settlement stands, the exception is an error line.
        if (result.exception !== undefined) errors.push(`${event.id}: ${result.exception}`)
        return
      }
      case 'REVERSAL': {
        ledger.reverse({
          originalRef: event.reverses,
          ref: event.id,
          bookedDay: event.bookedDay,
          valueDate: event.valueDate,
        })
        return
      }
    }
  }

  for (const event of events) {
    const closed = lastClosed.get(event.accountId)
    // The account list and the day window are configuration of the replay,
    // not stream data: there is no report row such an error could sit on.
    if (closed === undefined) {
      throw new Error(`${event.id}: unknown account ${event.accountId}`)
    }
    if (!Number.isInteger(event.bookedDay) || event.bookedDay < 1 || event.bookedDay > LAST_DAY) {
      throw new Error(`${event.id}: bookedDay ${event.bookedDay} is outside Days 1 to ${LAST_DAY}`)
    }

    const errors = errorsOf(event.accountId, event.bookedDay)
    // Never slipped into a closed day: rejected and reported on that day's row.
    if (event.bookedDay <= closed) {
      errors.push(`${event.id}: REJECTED: Day ${event.bookedDay} is already closed for ${event.accountId}`)
      continue
    }
    // Days are closed per account, just before its next event of a later day.
    closeThrough(event.accountId, event.bookedDay - 1)

    try {
      apply(event, errors)
    } catch (error) {
      // A rejected event is a report line, not a crash.
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${event.id}: REJECTED: ${message}`)
    }
  }

  for (const { accountId } of ACCOUNTS) closeThrough(accountId, LAST_DAY)

  // Rows were built per account; the report is ordered by day, then account.
  days.sort((a, b) => a.day - b.day || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0))
  return { days }
}

export function formatReport(report: ReplayReport): string {
  const lines: string[] = []
  const money = (row: DayReport, minor: bigint): string => `${row.currency} ${formatAmount(row.currency, minor)}`
  const fee = (minor: bigint): string => `${OVERDRAFT_FEE_CURRENCY} ${formatAmount(OVERDRAFT_FEE_CURRENCY, minor)}`
  // "Day 2, Day 4, Day 5 (AED 25.00 each, AED 75.00 total)", so the fees add up against the balance.
  const feeList = (ds: number[]): string => {
    if (ds.length === 0) return 'none'
    const days = ds.map((d) => `Day ${d}`).join(', ')
    const each = fee(OVERDRAFT_FEE_AMOUNT)
    return ds.length === 1
      ? `${days} (${each})`
      : `${days} (${each} each, ${fee(OVERDRAFT_FEE_AMOUNT * BigInt(ds.length))} total)`
  }
  let currentDay = 0

  for (const row of report.days) {
    if (row.day !== currentDay) {
      if (currentDay !== 0) lines.push('')
      lines.push(`Day ${row.day}`, '-'.repeat(72))
      currentDay = row.day
    }
    lines.push(
      `  ${row.accountId}   closing ${money(row, row.closingBalance).padStart(14)}` +
        `   available ${money(row, row.available).padStart(14)}`,
    )
    const detail = (label: string, value: string): void => {
      lines.push(`      ${label.padEnd(20)} ${value}`)
    }
    // The four things the brief asks for per day are always printed, with
    // "none" when empty: closing balance (above), fees, authorizations, errors.
    detail('fees assessed', feeList(row.feesAssessed))
    if (row.feesReversed.length > 0) detail('fees reversed', feeList(row.feesReversed))
    const auths = Object.entries(row.authorizations)
    detail('authorizations', auths.length > 0 ? auths.map(([id, status]) => `${id} ${status}`).join(', ') : 'none')
    if (row.errors.length === 0) detail('errors', 'none')
    row.errors.forEach((error, i) => detail(i === 0 ? 'errors' : '', error))
    detail('accrued interest', money(row, row.accruedInterest))
    if (row.interestCapitalized !== undefined) {
      detail('interest capitalized', money(row, row.interestCapitalized))
    }
  }
  return lines.join('\n')
}
