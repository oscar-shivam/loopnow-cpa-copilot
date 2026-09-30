import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal.Value;

export function decimal(value: DecimalInput): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) {
    throw new Error("Money value must be finite");
  }
  return parsed;
}

export function money(value: DecimalInput): Decimal {
  return decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function percentage(value: DecimalInput): Decimal {
  const parsed = decimal(value);
  if (parsed.lessThan(0) || parsed.greaterThan(100)) {
    throw new Error("Percentage must be between 0 and 100");
  }
  return parsed;
}

export function toMoneyString(value: DecimalInput): string {
  return money(value).toFixed(2);
}

export function toRateString(value: DecimalInput): string {
  return decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}
