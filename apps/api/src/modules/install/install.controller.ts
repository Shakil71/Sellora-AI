import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Injectable, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import IORedis from 'ioredis';
import { z } from 'zod';
import { Public, SkipCsrf } from '../../common/decorators';
import { zBody } from '../../common/zod.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { AuthService } from '../auth/auth.service';
import { TenantsService, PermissionSyncService } from '../tenants/tenants.service';
import { AppException, ConflictError } from '../../common/errors';
import { passwordSchema } from '../auth/auth.schemas';
import { env, ENV_FILE_PATH } from '../../config/env';
import { safeEqual } from '../../common/utils/crypto.util';

const run = promisify(execFile);
const INSTALLED_KEY = 'installed';

const dbSchema = z.object({ databaseUrl: z.string().trim().regex(/^postgres(ql)?:\/\//, 'Must start with postgresql://').max(500) });
const redisSchema = z.object({ redisUrl: z.string().trim().regex(/^rediss?:\/\//, 'Must start with redis://').max(500) });
const envSchema = z.object({
  databaseUrl: dbSchema.shape.databaseUrl.optional(),
  redisUrl: redisSchema.shape.redisUrl.optional(),
  appUrl: z.string().url().max(300).optional(),
  apiUrl: z.string().url().max(300).optional(),
  smtpHost: z.string().max(200).optional(),
  smtpPort: z.coerce.number().int().positive().optional(),
  smtpUser: z.string().max(200).optional(),
  smtpPassword: z.string().max(200).optional(),
  mailFrom: z.string().max(200).optional(),
  openaiApiKey: z.string().max(300).optional(),
});
const adminSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
  workspaceName: z.string().trim().min(2).max(100),
});

/** Quotes a value for a .env file. */
function envValue(v: string) {
  return /[\s#"'$]/.test(v) ? `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : v;
}

/**
 * Web installation wizard backend. Every mutating step is refused once the
 * installation is complete, and can require INSTALLER_TOKEN.
 */
@Injectable()
export class InstallService {
  private readonly logger = new Logger(InstallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
    private readonly permissions: PermissionSyncService,
  ) {}

  private lockFile() {
    return path.resolve(path.dirname(this.envPath()), 'storage', 'installed.lock');
  }

  envPath() {
    return ENV_FILE_PATH ?? path.resolve(process.cwd(), '../../.env');
  }

  async isInstalled(): Promise<boolean> {
    if (fs.existsSync(this.lockFile())) return true;
    try {
      return Boolean(await this.prisma.systemSetting.findUnique({ where: { key: INSTALLED_KEY } }));
    } catch {
      return false;
    }
  }

  async assertNotInstalled(token?: string) {
    if (await this.isInstalled()) throw new ConflictError('Sellora AI is already installed.');
    if (env.INSTALLER_TOKEN && (!token || !safeEqual(token, env.INSTALLER_TOKEN))) {
      throw new ForbiddenException({ code: 'INSTALLER_TOKEN', message: 'A valid installer token is required.' });
    }
  }

  async status() {
    const installed = await this.isInstalled();
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const [db, redis, storage] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy(), this.storage.provider.isHealthy()]);
    let migrated = false;
    let hasAdmin = false;
    if (db) {
      try {
        const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
        migrated = Number(rows[0]?.count ?? 0) > 0;
        if (migrated) hasAdmin = (await this.prisma.user.count({ where: { isSuperAdmin: true } })) > 0;
      } catch {
        migrated = false;
      }
    }
    return {
      installed,
      tokenRequired: Boolean(env.INSTALLER_TOKEN),
      requirements: [
        { key: 'node', label: `Node.js ${process.versions.node}`, ok: nodeMajor >= 20, hint: 'Node.js 20 or newer is required' },
        { key: 'database', label: 'PostgreSQL connection', ok: db, hint: 'Check DATABASE_URL' },
        { key: 'redis', label: 'Redis connection', ok: redis, hint: 'Check REDIS_URL' },
        { key: 'storage', label: `File storage (${this.storage.provider.driver})`, ok: storage, hint: 'Storage path must be writable' },
        { key: 'secrets', label: 'Security keys', ok: Boolean(env.JWT_SECRET && env.ENCRYPTION_KEY), hint: 'JWT_SECRET and ENCRYPTION_KEY must be set' },
        { key: 'envFile', label: '.env file writable', ok: this.envWritable(), hint: `Make ${this.envPath()} writable during installation` },
      ],
      migrated,
      hasAdmin,
      config: { appUrl: env.APP_URL, apiUrl: env.API_URL, smtpConfigured: Boolean(env.SMTP_HOST), aiConfigured: Boolean(env.OPENAI_API_KEY) },
    };
  }

  private envWritable() {
    try {
      const p = this.envPath();
      if (fs.existsSync(p)) fs.accessSync(p, fs.constants.W_OK);
      else fs.accessSync(path.dirname(p), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  async testDatabase(url: string) {
    const client = new PrismaClient({ datasourceUrl: url });
    try {
      await client.$queryRaw`SELECT 1`;
      const version = await client.$queryRaw<Array<{ version: string }>>`SELECT version()`;
      return { ok: true, version: version[0]?.version?.split(',')[0] };
    } catch (err) {
      return { ok: false, error: (err as Error).message.split('\n').slice(-2).join(' ').slice(0, 300) };
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }

  async testRedis(url: string) {
    const client = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 4000, retryStrategy: () => null });
    try {
      await client.connect();
      const info = await client.info('server');
      return { ok: true, version: /redis_version:([^\r\n]+)/.exec(info)?.[1] };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      client.disconnect();
    }
  }

  /** Merges values into .env (secrets are generated when missing). A restart is needed afterwards. */
  writeEnvironment(input: z.infer<typeof envSchema>) {
    const file = this.envPath();
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const updates: Record<string, string | undefined> = {
      DATABASE_URL: input.databaseUrl,
      REDIS_URL: input.redisUrl,
      APP_URL: input.appUrl,
      API_URL: input.apiUrl,
      CORS_ORIGINS: input.appUrl,
      SMTP_HOST: input.smtpHost,
      SMTP_PORT: input.smtpPort ? String(input.smtpPort) : undefined,
      SMTP_USER: input.smtpUser,
      SMTP_PASSWORD: input.smtpPassword,
      MAIL_FROM: input.mailFrom,
      OPENAI_API_KEY: input.openaiApiKey,
    };
    if (!/^JWT_SECRET=.+/m.test(existing)) updates.JWT_SECRET = randomBytes(48).toString('hex');
    if (!/^JWT_REFRESH_SECRET=.+/m.test(existing)) updates.JWT_REFRESH_SECRET = randomBytes(48).toString('hex');
    if (!/^ENCRYPTION_KEY=.+/m.test(existing)) updates.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    let content = existing;
    const written: string[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === '') continue;
      const line = `${key}=${envValue(value)}`;
      const re = new RegExp(`^${key}=.*$`, 'm');
      content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
      written.push(key);
    }
    fs.writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 });
    return { written, file, restartRequired: true };
  }

  /** Runs `prisma migrate deploy` (never a destructive reset). */
  async migrate() {
    const apiRoot = path.resolve(__dirname, '../../..');
    const prismaBin = [path.join(apiRoot, 'node_modules/.bin/prisma'), path.resolve(apiRoot, '../../node_modules/.bin/prisma')].find((p) => fs.existsSync(p) || fs.existsSync(`${p}.cmd`));
    if (!prismaBin) throw new AppException('PRISMA_MISSING', 'Prisma CLI not found. Run "npm install" first.', 500);
    const bin = process.platform === 'win32' ? `${prismaBin}.cmd` : prismaBin;
    try {
      const { stdout, stderr } = await run(bin, ['migrate', 'deploy', '--schema', path.join(apiRoot, 'prisma/schema.prisma')], {
        cwd: apiRoot,
        env: { ...process.env },
        timeout: 5 * 60_000,
        shell: process.platform === 'win32',
      });
      await this.permissions.sync();
      return { ok: true, output: `${stdout}\n${stderr}`.trim().split('\n').slice(-15).join('\n') };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? e.message}`.trim().split('\n').slice(-20).join('\n') };
    }
  }

  async createAdmin(input: z.infer<typeof adminSchema>) {
    if ((await this.prisma.user.count({ where: { isSuperAdmin: true } })) > 0) throw new ConflictError('A platform administrator already exists.');
    await this.permissions.sync();
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictError('A user with this email already exists.');
    const user = await this.prisma.user.create({
      data: { email: input.email, name: input.name, passwordHash: await this.auth.hashPassword(input.password), isSuperAdmin: true, emailVerifiedAt: new Date() },
    });
    const tenant = await this.tenants.provision(user.id, { name: input.workspaceName });
    return { userId: user.id, tenantId: tenant.id };
  }

  async finish() {
    if ((await this.prisma.user.count({ where: { isSuperAdmin: true } })) === 0) {
      throw new AppException('NO_ADMIN', 'Create the administrator account first.');
    }
    await this.prisma.systemSetting.upsert({
      where: { key: INSTALLED_KEY },
      create: { key: INSTALLED_KEY, value: { at: new Date().toISOString(), version: process.env.npm_package_version ?? '1.0.0' } },
      update: { value: { at: new Date().toISOString() } },
    });
    try {
      fs.mkdirSync(path.dirname(this.lockFile()), { recursive: true });
      fs.writeFileSync(this.lockFile(), new Date().toISOString());
    } catch (err) {
      this.logger.warn(`Could not write install lock file: ${(err as Error).message}`);
    }
    return { installed: true };
  }
}

@Controller('install')
@Public()
@SkipCsrf()
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class InstallController {
  constructor(private readonly install: InstallService) {}

  @Get('status')
  status() {
    return this.install.status();
  }

  @Post('test-database')
  @HttpCode(200)
  async testDb(@Headers('x-installer-token') token: string | undefined, @Body(zBody(dbSchema)) body: z.infer<typeof dbSchema>) {
    await this.install.assertNotInstalled(token);
    return this.install.testDatabase(body.databaseUrl);
  }

  @Post('test-redis')
  @HttpCode(200)
  async testRedis(@Headers('x-installer-token') token: string | undefined, @Body(zBody(redisSchema)) body: z.infer<typeof redisSchema>) {
    await this.install.assertNotInstalled(token);
    return this.install.testRedis(body.redisUrl);
  }

  @Post('environment')
  @HttpCode(200)
  async environment(@Headers('x-installer-token') token: string | undefined, @Body(zBody(envSchema)) body: z.infer<typeof envSchema>) {
    await this.install.assertNotInstalled(token);
    return this.install.writeEnvironment(body);
  }

  @Post('migrate')
  @HttpCode(200)
  async migrate(@Headers('x-installer-token') token?: string) {
    await this.install.assertNotInstalled(token);
    return this.install.migrate();
  }

  @Post('admin')
  @HttpCode(200)
  async admin(@Headers('x-installer-token') token: string | undefined, @Body(zBody(adminSchema)) body: z.infer<typeof adminSchema>) {
    await this.install.assertNotInstalled(token);
    return this.install.createAdmin(body);
  }

  @Post('finish')
  @HttpCode(200)
  async finish(@Headers('x-installer-token') token?: string) {
    await this.install.assertNotInstalled(token);
    return this.install.finish();
  }
}
