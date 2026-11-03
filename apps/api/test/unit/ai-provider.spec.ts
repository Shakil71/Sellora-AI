import { AIProviderService } from '../../src/modules/ai/ai-provider.service';
import { encryptJson } from '../../src/common/utils/crypto.util';
import { resetEnvCache } from '../../src/config/env';
import { assertPublicUrl, isPrivateAddress } from '../../src/modules/ai/text-extraction';

describe('SSRF address checks', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.16.5.5', '0.0.0.0', '100.64.0.1',
    '::', '::1', 'fe80::1', 'fd00::1', 'fec0::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:a9fe:a9fe', '::a9fe:a9fe', '64:ff9b::a9fe:a9fe',
    'not-an-ip',
  ])('refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  it('refuses IPv4-mapped IPv6 URLs, which the URL parser rewrites to hex', async () => {
    await expect(assertPublicUrl('http://[::ffff:169.254.169.254]/v1')).rejects.toThrow('not publicly reachable');
    await expect(assertPublicUrl('http://[::ffff:127.0.0.1]:6379/')).rejects.toThrow('not publicly reachable');
  });
});

const PLATFORM_URL = 'https://api.openai.com/v1';

function make(stored: Record<string, unknown> | undefined) {
  const prisma = {
    tenant: { findUnique: jest.fn(async () => ({ aiConfigEnc: stored ? encryptJson(stored) : null })) },
  };
  return new AIProviderService(prisma as never, {} as never);
}

describe('AI provider configuration', () => {
  beforeAll(() => {
    process.env.OPENAI_API_KEY = 'sk-platform-key-0000000000';
    process.env.OPENAI_BASE_URL = PLATFORM_URL;
    resetEnvCache();
  });
  afterAll(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    resetEnvCache();
  });

  it('never sends the platform key to a workspace-chosen URL', async () => {
    const cfg = await make({ provider: 'openai', baseUrl: 'https://attacker.example/v1', chatModel: 'gpt-x' }).resolve('t1');
    expect(cfg).toMatchObject({ source: 'platform', apiKey: 'sk-platform-key-0000000000', baseUrl: PLATFORM_URL, chatModel: 'gpt-x' });
  });

  it("uses a workspace URL with the workspace's own key", async () => {
    const cfg = await make({ provider: 'openai', apiKey: 'sk-own-key-1111111111', baseUrl: 'https://llm.example/v1' }).resolve('t1');
    expect(cfg).toMatchObject({ source: 'workspace', apiKey: 'sk-own-key-1111111111', baseUrl: 'https://llm.example/v1' });
  });

  it('refuses to save a private base URL', async () => {
    await expect(
      make(undefined).updateSettings({ tenantId: 't1', userId: 'u1', name: 'Owner', type: 'USER' }, { provider: 'openai', baseUrl: 'http://169.254.169.254/latest' }),
    ).rejects.toThrow('not publicly reachable');
  });
});
