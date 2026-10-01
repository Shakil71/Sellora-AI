import { passwordProblem } from '@sellora/shared';
import { passwordSchema } from '../../src/modules/auth/auth.schemas';

describe('password rules', () => {
  it('accepts strong passwords', () => {
    expect(passwordProblem('Tr1cky-Banana-77')).toBeNull();
    expect(passwordProblem('correct horse 7 battery')).toBeNull();
    expect(passwordSchema.safeParse('Orange!Tiger42x').success).toBe(true);
  });

  it('rejects short, letterless and numberless passwords', () => {
    expect(passwordProblem('Ab1')).toMatch(/at least 10/);
    expect(passwordProblem('1234567890123')).toMatch(/letter/);
    expect(passwordProblem('abcdefghijklmn')).toMatch(/number/);
  });

  it('rejects common passwords even with digits or symbols added', () => {
    for (const pw of ['Password123', 'Passw0rd123', 'qwerty12345', 'Welcome1234!', 'sellora2026', 'Admin123456']) {
      expect(passwordProblem(pw)).toMatch(/too common/);
      expect(passwordSchema.safeParse(pw).success).toBe(false);
    }
  });

  it('rejects repetitive and sequential passwords', () => {
    expect(passwordProblem('aaaaaaaaaa1')).toMatch(/repetitive/);
    expect(passwordProblem('1212121212a')).toMatch(/repetitive/);
    expect(passwordProblem('1234567890ab')).toMatch(/easy to guess/);
  });
});
