import { toUtcStartOfDay } from "@/lib/utils";

export const DEFAULT_BILLING_CYCLE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDaysUtc(date: Date, days: number) {
  return new Date(toUtcStartOfDay(date).getTime() + days * MS_PER_DAY);
}

export function normalizeBillDateConfiguration(
  value: number | string | null | undefined,
) {
  if (value === null || typeof value === "undefined" || value === "") {
    return null;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    return null;
  }

  return parsed;
}

export function clampConfiguredBillingDate(
  date: Date,
  _configuredBillDay: number | null | undefined,
) {
  return toUtcStartOfDay(date);
}

export function calculateInitialNextBillingDate(
  referenceDate: Date,
  configuredBillDay: number | null | undefined,
) {
  const normalizedBillDay = normalizeBillDateConfiguration(configuredBillDay);
  const normalizedReferenceDate = toUtcStartOfDay(referenceDate);

  if (!normalizedBillDay) {
    return addDaysUtc(normalizedReferenceDate, DEFAULT_BILLING_CYCLE_DAYS);
  }

  return addDaysUtc(normalizedReferenceDate, normalizedBillDay);
}

export function calculateNextBillingDate(
  referenceDate: Date,
  configuredBillDay: number | null | undefined,
) {
  const normalizedBillDay = normalizeBillDateConfiguration(configuredBillDay);
  const normalizedReferenceDate = toUtcStartOfDay(referenceDate);

  if (!normalizedBillDay) {
    return addDaysUtc(normalizedReferenceDate, DEFAULT_BILLING_CYCLE_DAYS);
  }

  return addDaysUtc(normalizedReferenceDate, normalizedBillDay);
}
