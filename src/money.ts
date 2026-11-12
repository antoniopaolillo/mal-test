export type Currency = 'AED' | 'BHD'

const PRECISION: Record<Currency, number> = { AED: 2, BHD: 3 }

export function parseAmount(currency: Currency, text: string): bigint {
  const precision = PRECISION[currency]
  // Whole part: plain digits or properly grouped thousands ("1,200"). No sign.
  const regex = new RegExp(`^(\\d+|\\d{1,3}(,\\d{3})+)(\\.\\d{1,${precision}})?$`)
  if (!regex.test(text)) {
    throw new Error(`Invalid amount format for ${currency}: ${text}`)
  }
  const [whole = '', fraction = ''] = text.replaceAll(',', '').split('.')
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0'))
}

export function formatAmount(currency: Currency, minor: bigint): string {
  const precision = PRECISION[currency]
  const factor = 10n ** BigInt(precision)
  const sign = minor < 0n ? '-' : ''
  const abs = minor < 0n ? -minor : minor
  const whole = abs / factor
  const fraction = (abs % factor).toString().padStart(precision, '0')
  return `${sign}${whole.toString()}.${fraction}`
}

export function splitEqually(total: bigint, parts: number): bigint[] {
  if (parts <= 0 || !Number.isInteger(parts)) {
    throw new Error('Parts must be a positive integer')
  }
  if (total < 0n) {
    throw new Error('Total amount must be non-negative')
  }
  const base = total / BigInt(parts)
  const remainder = Number(total % BigInt(parts))
  // The remainder goes to the LAST instalments, one minor unit each.
  return Array.from({ length: parts }, (_, i) => (i >= parts - remainder ? base + 1n : base))
}

export function roundHalfEven(num: bigint, den: bigint): bigint {
  if (num < 0n) {
    throw new Error('Numerator must be non-negative')
  }
  if (den <= 0n) {
    throw new Error('Denominator must be positive')
  }
  const quotient = num / den
  const remainder = num % den
  if (remainder * 2n < den) {
    return quotient
  } else if (remainder * 2n > den) {
    return quotient + 1n
  } else {
    // Tie: round to the nearest even integer
    return quotient % 2n === 0n ? quotient : quotient + 1n
  }
}
