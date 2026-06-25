export type PasswordValidationResult = {
  valid: boolean;
  message?: string;
  code?: string;
};

/** Minimum password rules — at least 8 chars, upper+lower+ digit, not whitespace-only. */
export function validatePasswordPolicy(
  password: string,
): PasswordValidationResult {
  if (!password.trim() || /^\s+$/.test(password)) {
    return {
      valid: false,
      code: "PASSWORD_BLANK",
      message: "密码不能为空或全为空格",
    };
  }
  if (password.length < 8) {
    return {
      valid: false,
      code: "PASSWORD_TOO_SHORT",
      message: "密码至少 8 位",
    };
  }
  if (!/[A-Za-z]/.test(password)) {
    return {
      valid: false,
      code: "PASSWORD_MISSING_LETTER",
      message: "密码需包含至少一个英文字母",
    };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      code: "PASSWORD_MISSING_UPPERCASE",
      message: "密码需包含至少一个大写字母",
    };
  }
  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      code: "PASSWORD_MISSING_LOWERCASE",
      message: "密码需包含至少一个小写字母",
    };
  }
  if (!/\d/.test(password)) {
    return {
      valid: false,
      code: "PASSWORD_MISSING_DIGIT",
      message: "密码需包含至少一个数字",
    };
  }
  return { valid: true };
}
