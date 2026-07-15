// Server-side helper to check whether a password has appeared in known breaches
// using the Have I Been Pwned Pwned Passwords API (k-anonymity model).
// This SHOULD only be used on server-side code to avoid exposing passwords.

import crypto from "crypto";

export async function isPwnedPassword(
  password: string,
  opts?: { maxBreaches?: number },
): Promise<{ pwned: boolean; count: number }> {
  const raw = String(password || "");
  if (!raw) return { pwned: false, count: 0 };

  // Compute SHA1 hash (uppercase hex)
  const sha1 = crypto
    .createHash("sha1")
    .update(raw, "utf8")
    .digest("hex")
    .toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  // Query the HIBP range API with the prefix
  const url = `https://api.pwnedpasswords.com/range/${prefix}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        // HIBP recommends sending a descriptive User-Agent
        "User-Agent": "NibteraBMS-PwnedCheck/1.0",
        Accept: "text/plain",
      },
    });

    if (!res.ok) {
      // If the API is unavailable, fail open (don't block password) but
      // return an indicator so callers can decide whether to block or not.
      return { pwned: false, count: 0 };
    }

    const text = await res.text();
    // Response lines are like: Suffix:Count
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const [hashSuffix, countStr] = line.split(":");
      if (!hashSuffix) continue;
      if (hashSuffix.toUpperCase() === suffix) {
        const count = Number(countStr || "0");
        const max =
          typeof opts?.maxBreaches === "number" ? opts!.maxBreaches : 0;
        const pwned = max > 0 ? count >= max : count > 0;
        return { pwned, count };
      }
    }

    return { pwned: false, count: 0 };
  } catch (err) {
    // Network or other error: fail open (do not block) but surface non-blocking result
    return { pwned: false, count: 0 };
  }
}

export default isPwnedPassword;
