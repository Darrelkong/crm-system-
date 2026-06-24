export type PasswordValidationResult = {
  valid: boolean;
  message?: string;
};

/** Minimum password rules aligned with seed accounts (e.g. Admin123!). */
export function validatePasswordPolicy(
  password: string,
): PasswordValidationResult {
  if (password.length < 8) {
    return { valid: false, message: "密码至少 8 位" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "密码需包含至少一个大写字母" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "密码需包含至少一个小写字母" };
  }
  if (!/\d/.test(password)) {
    return { valid: false, message: "密码需包含至少一个数字" };
  }
  return { valid: true };
}
