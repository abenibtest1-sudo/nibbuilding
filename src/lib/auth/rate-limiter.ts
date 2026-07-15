
import 'server-only';
export const runtime = "nodejs";

import { prisma } from '@/lib/prisma';
import { differenceInMinutes } from 'date-fns';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 1;

/**
 * Checks and updates the rate limit for a given identifier (IP or phone number)
 * using a database-backed model.
 * @param identifier - The string to rate limit on (e.g., an IP address or a phone number).
 * @returns {Promise<{ success: boolean; limit: number; remaining: number; reset: number }>}
 */
export async function rateLimiter(identifier: string) {
  const now = new Date();
  const record = await prisma.rateLimit.findUnique({
    where: { identifier },
  });

  if (record) {
    const minutesSinceFirstAttempt = differenceInMinutes(now, record.firstAttemptAt);

    // If the record is older than the lockout period, delete it and let the request proceed as a new first attempt.
    if (minutesSinceFirstAttempt >= LOCKOUT_MINUTES) {
      await prisma.rateLimit.delete({ where: { identifier } });
    } else {
      // If within the lockout period and attempts are maxed out, block the request.
      if (record.attempts >= MAX_ATTEMPTS) {
        return {
          success: false,
          limit: MAX_ATTEMPTS,
          remaining: 0,
          reset: record.firstAttemptAt.getTime() + LOCKOUT_MINUTES * 60 * 1000,
        };
      }
      // Otherwise, increment the attempt count.
      const updatedRecord = await prisma.rateLimit.update({
        where: { identifier },
        data: { attempts: { increment: 1 } },
      });
      return {
        success: true,
        limit: MAX_ATTEMPTS,
        remaining: MAX_ATTEMPTS - updatedRecord.attempts,
        reset: updatedRecord.firstAttemptAt.getTime() + LOCKOUT_MINUTES * 60 * 1000,
      };
    }
  }

  // If no record exists, this is the first attempt. Create a new record.
  const newRecord = await prisma.rateLimit.create({
    data: {
      identifier: identifier,
      attempts: 1,
      firstAttemptAt: now,
    },
  });

  return {
    success: true,
    limit: MAX_ATTEMPTS,
    remaining: MAX_ATTEMPTS - newRecord.attempts,
    reset: newRecord.firstAttemptAt.getTime() + LOCKOUT_MINUTES * 60 * 1000,
  };
}
