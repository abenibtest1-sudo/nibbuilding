// Shared common password list and utilities
// Provides a case-insensitive exact match and a small fuzzy check
// (Levenshtein distance <= 1) to catch trivial variants.

const RAW_COMMON_PASSWORDS = [
  "Admin@123",
  "Admin@1234",
  "Admin@2024",
  "Admin@2025",
  "Admin@111",
  "Admin@321",
  "Admin@Password1",
  "Admin@Pass1",
  "Admin@999",
  "Admin@000",
  "Password@1",
  "Password@123",
  "Password@2024",
  "Pass@1234",
  "Pass@12345",
  "Welcome@1",
  "Welcome@123",
  "Welcome@2024",
  "Welcome@2025",
  "Qwerty@123",
  "Qwerty@2024",
  "Qwerty@1",
  "Qwerty@12",
  "Test@1234",
  "Test@123",
  "Testing@1",
  "Testing@123",
  "System@123",
  "System@1",
  "Root@1234",
  "Root@123",
  "Root@2024",
  "Root@2025",
  "SuperAdmin@1",
  "SuperAdmin@123",
  "Manager@123",
  "Manager@1",
  "AdminUser@1",
  "AdminUser@123",
  "Letmein@123",
  "LetMeIn@1",
  "Letmein@2024",
  "Letmein@2025",
  "Default@123",
  "Default@1",
  "ChangeMe@1",
  "ChangeMe@123",
  "Changeme@2024",
  "Changeme@2025",
  "Secure@123",
  "Secure@1",
  "Security@123",
  "Security@1",
  "Password1@",
  "Password123@",
  "Abcd@1234",
  "Abcdef@1",
  "Admin123@",
  "Admin@abcd1",
  "Admin@admin1",
  "NibAdmin@123",
  "NibAdmin@1",
  "BankAdmin@123",
  "BankAdmin@1",
  "Login@1234",
  "Login@123",
  "Portal@123",
  "Portal@1",
  "User@1234",
  "User@123",
  "Company@123",
  "Company@1",
  "Office@123",
  "Office@1",
  "OfficeAdmin@1",
  "OfficeAdmin@123",
  "Team@1234",
  "Team@123",
  "Support@123",
  "Support@1",
  "User@2024",
  "User@2025",
  "Hello@123",
  "Hello@2024",
  "Hello@1",
  "Pass@2024",
  "Pass@2025",
  "Qwerty@2025",
  "Testuser@1",
  "TestUser@123",
  "MyPass@123",
  "MyPass@2024",
  "Abcdef@12",
  "Login@2024",
  "Login@1",
  "Ethiopia@1",
  "Ethiopia@123",
  "NibUser@1",
  "NibUser@123",
  "Customer@1",
  "Customer@123",
  "Member@123",
];

const NORMALIZED_SET = new Set(
  RAW_COMMON_PASSWORDS.map((p) => p.trim().toLowerCase()),
);

// Simple Levenshtein distance implementation (iterative, small strings only)
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const dp: number[] = Array(bl + 1)
    .fill(0)
    .map((_, i) => i);
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const temp = dp[j];
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[bl];
}

export function isCommonPassword(
  password: string,
  opts?: { fuzzy?: boolean; maxDistance?: number },
) {
  const raw = String(password || "").trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  if (NORMALIZED_SET.has(normalized)) return true;
  if (opts?.fuzzy) {
    const max = typeof opts.maxDistance === "number" ? opts.maxDistance : 1;
    for (const candidate of NORMALIZED_SET) {
      if (levenshtein(normalized, candidate) <= max) return true;
    }
  }
  return false;
}

export { RAW_COMMON_PASSWORDS as COMMON_PASSWORDS_LIST };
