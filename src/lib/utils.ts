import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateOnlyUTC(date?: string | Date | null) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

export function toUtcStartOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function isAfterUtcDay(left: Date, right: Date): boolean {
  return toUtcStartOfDay(left).getTime() > toUtcStartOfDay(right).getTime();
}

export function differenceInUtcDays(later: Date, earlier: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor(
    (toUtcStartOfDay(later).getTime() - toUtcStartOfDay(earlier).getTime()) /
      msPerDay,
  );
}
