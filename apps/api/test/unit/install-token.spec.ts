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
