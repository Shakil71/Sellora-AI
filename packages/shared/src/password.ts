/**
 * Password rules shared by the API (which enforces them) and the web app
 * (which shows them while typing).
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Passwords attackers try first. Matched case-insensitively and ignoring trailing digits or symbols. */
const COMMON = new Set(
  [
    'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'qwerty', 'qwertyuiop', 'qwerty123', 'asdfghjkl', 'zxcvbnm', '1qaz2wsx', 'qazwsxedc',
    'letmein', 'welcome', 'welcome1', 'admin', 'administrator', 'adminadmin', 'root', 'toor', 'login', 'master', 'monkey', 'dragon', 'sunshine',
    'princess', 'football', 'baseball', 'superman', 'batman', 'iloveyou', 'trustno1', 'shadow', 'michael', 'jennifer', 'abc123', 'abcdefgh',
    'abcdefghij', 'changeme', 'default', 'secret', 'sellora', 'selloraai', 'sellora123', 'whatsapp', 'whatsapp123', 'ecommerce', 'business',
    'company', 'test', 'testtest', 'demo', 'demodemo', 'hello', 'helloworld', 'freedom', 'cheese', 'internet', 'computer', 'summer', 'winter',
    'bangladesh', 'dhaka', 'iloveyou1', 'google', 'facebook', 'password1', 'password12', 'password123', 'password1234',
  ].map((p) => p.toLowerCase()),
);

/** Why a password is not acceptable, or null when it is fine. The message is safe to show to the user. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH) return 'Password is too long';
  if (!/[A-Za-z]/.test(password)) return 'Password must contain a letter';
  if (!/\d/.test(password)) return 'Password must contain a number';
  const base = password.toLowerCase().replace(/[\d!@#$%^&*?._-]+$/, '');
  if (COMMON.has(password.toLowerCase()) || COMMON.has(base)) return 'This password is too common. Choose something harder to guess';
  if (/^(.)\1+$/.test(password) || new Set(password).size < 4) return 'Password is too repetitive';
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(password)) return 'Password is too easy to guess';
  return null;
}
