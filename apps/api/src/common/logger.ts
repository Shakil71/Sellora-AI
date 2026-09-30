import { randomUUID } from 'crypto';
import type { Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';
import { env, isProduction } from '../config/env';
import type { AppRequest } from './auth-context';

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,100}$/;

/**
 * Structured JSON logs with timestamp, level, service, request id, and the
 * user/tenant when known. Secrets and cookies are redacted.
 */
export function loggerOptions(service: string): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && REQUEST_ID_RE.test(header) ? header : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req: IncomingMessage) => {
        const auth = (req as AppRequest).auth;
        return auth ? { userId: auth.userId ?? undefined, tenantId: auth.tenantId ?? undefined } : {};
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-csrf-token"]',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.accessToken',
          'req.body.appSecret',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url?.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: {
        ignore: (req: IncomingMessage) => Boolean(req.url?.startsWith('/health')),
      },
      transport: isProduction()
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
    },
  };
}
