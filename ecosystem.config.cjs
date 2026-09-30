/**
 * PM2 process definitions for Sellora AI (no Docker).
 *
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup
 *
 * Configuration comes from the project-root .env file. On the VPS,
 * /opt/sellora-ai/app/.env is a symlink to /opt/sellora-ai/.env.
 */
const path = require('path');

const ROOT = __dirname;

/** Read a key from the project .env without requiring extra dependencies. */
function envValue(key, fallback) {
  if (process.env[key]) return process.env[key];
  try {
    const text = require('fs').readFileSync(path.join(ROOT, '.env'), 'utf8');
    const match = text.match(new RegExp('^' + key + '=(.*)$', 'm'));
    if (match) return match[1].trim().replace(/^["']|["']$/g, '') || fallback;
  } catch {
    /* no .env: use the fallback */
  }
  return fallback;
}

const WEB_PORT = envValue('WEB_PORT', '3000');
const LOG_DIR = process.env.SELLORA_LOG_DIR || path.resolve(ROOT, '..', 'logs');

const common = {
  cwd: ROOT,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 20,
  min_uptime: '20s',
  exp_backoff_restart_delay: 200,
  kill_timeout: 10000,
  merge_logs: true,
  time: false,
  env_production: { NODE_ENV: 'production' },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'sellora-api',
      script: 'apps/api/dist/main.js',
      max_memory_restart: '900M',
      out_file: path.join(LOG_DIR, 'api.out.log'),
      error_file: path.join(LOG_DIR, 'api.err.log'),
    },
    {
      ...common,
      name: 'sellora-worker',
      script: 'apps/api/dist/worker.js',
      max_memory_restart: '900M',
      out_file: path.join(LOG_DIR, 'worker.out.log'),
      error_file: path.join(LOG_DIR, 'worker.err.log'),
    },
    {
      ...common,
      name: 'sellora-web',
      cwd: path.join(ROOT, 'apps/web'),
      script: path.join(ROOT, 'node_modules/next/dist/bin/next'),
      args: `start --port ${WEB_PORT} --hostname 127.0.0.1`,
      max_memory_restart: '700M',
      out_file: path.join(LOG_DIR, 'web.out.log'),
      error_file: path.join(LOG_DIR, 'web.err.log'),
    },
  ],
};
