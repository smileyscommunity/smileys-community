// Payment amounts are stored as Float, and a sum of many kuruş/cent amounts
// drifts (1234.5600000001) in totals and CSVs. Every stored amount is a
// two-decimal value, so rounding a total to cents recovers it exactly.
export const roundMoney = (n: number | null | undefined): number => Math.round((n ?? 0) * 100) / 100
