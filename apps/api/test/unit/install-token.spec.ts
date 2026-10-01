import { InstallService } from '../../src/modules/install/install.controller';

function make() {
  const svc = new InstallService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  jest.spyOn(svc, 'isInstalled').mockResolvedValue(false);
  jest.spyOn(svc, 'expectedToken').mockReturnValue({ value: 'a1b2c3d4e5f6a7b8', source: 'file' });
  return svc;
}

describe('installer token', () => {
  it('refuses every installer step without the right token', async () => {
    const svc = make();
    await expect(svc.assertNotInstalled(undefined)).rejects.toThrow('installer token');
    await expect(svc.assertNotInstalled('wrong-token-value')).rejects.toThrow('installer token');
    await expect(svc.assertNotInstalled('a1b2c3d4e5f6a7b9')).rejects.toThrow('installer token');
  });

  it('accepts the right token, ignoring surrounding spaces', async () => {
    const svc = make();
    await expect(svc.assertNotInstalled(' a1b2c3d4e5f6a7b8 ')).resolves.toBeUndefined();
  });

  it('refuses everything once installed, even with the token', async () => {
    const svc = make();
    jest.spyOn(svc, 'isInstalled').mockResolvedValue(true);
    await expect(svc.assertNotInstalled('a1b2c3d4e5f6a7b8')).rejects.toThrow('already installed');
  });
});

describe('installer token file', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');

  it('is created next to the .env file, is reused after a restart, and looks like a 32 character code', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sellora-'));
    const mk = () => {
      const svc = new InstallService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
      jest.spyOn(svc, 'envPath').mockReturnValue(path.join(dir, '.env'));
      return svc;
    };
    const first = mk().expectedToken();
    expect(first.value).toMatch(/^[0-9a-f]{32}$/);
    const file = path.join(dir, 'storage', 'install-token.txt');
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(first.value);
    // A restarted API (new instance) must show the same token, not a new one.
    expect(mk().expectedToken().value).toBe(first.value);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
