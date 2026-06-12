export interface PasswordPolicyResult {
  passed: boolean;
  issues: string[];
}

const COMMON_PASSWORD_PATTERNS = [
  /password/i,
  /123456/,
  /qwerty/i,
  /letmein/i,
  /welcome/i,
  /admin/i,
  /smoke-password/i,
  /test-password/i
];

export function validateOperationalPassword(password: string): PasswordPolicyResult {
  const issues: string[] = [];

  if (password.length < 24) {
    issues.push("at least 24 characters");
  }
  if (!/[a-z]/u.test(password)) {
    issues.push("a lowercase letter");
  }
  if (!/[A-Z]/u.test(password)) {
    issues.push("an uppercase letter");
  }
  if (!/[0-9]/u.test(password)) {
    issues.push("a number");
  }
  if (!/[^A-Za-z0-9]/u.test(password)) {
    issues.push("a symbol");
  }
  if (COMMON_PASSWORD_PATTERNS.some((pattern) => pattern.test(password))) {
    issues.push("no common password words or obvious test placeholders");
  }

  return {
    passed: issues.length === 0,
    issues
  };
}
