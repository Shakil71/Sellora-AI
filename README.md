# Sellora AI

**AI-Powered WhatsApp Sales & Commerce Automation**

Sellora AI is a multi-tenant SaaS platform that turns WhatsApp conversations into revenue. It combines an AI sales agent, a realtime team inbox, CRM, product catalog, inventory, orders, invoices, automation workflows and analytics in one product.

## Highlights

- **AI Sales Agent** with a controlled tool system (search products, check stock, quote totals, create leads and orders, hand off to humans). Every tool call is authorized, validated and logged.
- **WhatsApp Cloud API** integration with signed webhooks, delivery receipts, templates and the 24-hour window.
- **More channels**: an embeddable website chat (one line of code for any site, including WordPress, Shopify and Wix), Facebook Messenger and Instagram Direct.
- **Omnichannel inbox** with AI/human takeover, assignments, internal notes, attachments and realtime updates across every channel.
- **Integrations for your own systems**: a REST API with scoped API keys and signed outgoing webhooks (orders, leads, messages, stock) with retries and a delivery log.
- **CRM**: leads, customers, deals, drag-and-drop pipelines and tasks.
- **Commerce**: products, categories, inventory with reservations, orders, payments, refunds, invoices (PDF) and deliveries.
- **Knowledge base (RAG)**: PDF, DOCX, TXT, Markdown and web pages, with semantic or keyword retrieval.
- **Automation**: visual node-based workflows, background execution, retries, run logs.
- **Security**: tenant isolation, granular RBAC, HTTP-only cookie sessions with refresh rotation, CSRF protection, 2FA, audit logs, encrypted secrets, rate limiting.
- **Deployment without Docker**: Node.js, PostgreSQL, Redis, PM2 and Nginx on any Ubuntu VPS.

## Tech stack

| Layer | Technology |
| --- | --- |
| Web | Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Radix/shadcn-style UI, TanStack Query, React Hook Form, Zod, Recharts, React Flow, dnd-kit |
| API | NestJS 11, Prisma 6, PostgreSQL, Redis, BullMQ, Socket.IO |
| Worker | NestJS application context running BullMQ processors |
| Ops | PM2, Nginx, Bash deploy and backup scripts |

## Repository layout

```
apps/api        REST API, realtime gateway, background worker, Prisma schema
apps/web        Web application and marketing site
packages/shared Permissions, plans, automation catalog, money math (shared by API and web)
deploy/         Nginx config, VPS setup, backup and restore scripts
docs/           Installation, deployment, API and operations guides
deploy.sh       Repeatable production deployment
ecosystem.config.cjs  PM2 process definitions
```

## Quick start (local)

Requirements: Node.js 20+, PostgreSQL 14+, Redis 6.2+.

```bash
cp .env.example .env          # fill DATABASE_URL, REDIS_URL, JWT secrets, ENCRYPTION_KEY
npm install
npm run db:deploy             # create tables
npm run db:seed:demo          # optional demo workspace "Acme Commerce"
npm run dev                   # web :3000, API :4000, worker
```

Open http://localhost:3000. Demo sign-in (only if you seeded demo data): `demo@sellora.test` / `SelloraDemo2026`.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Deployment on a VPS (no Docker)](docs/DEPLOYMENT.md)
- [Environment variables](docs/ENVIRONMENT.md)
- [Product documentation](docs/DOCUMENTATION.md)
- [REST API](docs/API.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run web, API and worker in watch mode |
| `npm run build` | Build shared package, API and web |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm test` | Unit tests (shared + API) |
| `npm run test:integration` | API integration tests (needs a `*_test` database and Redis) |
| `npm run test:e2e` | Playwright end-to-end tests against a running stack |
| `npm run db:deploy` | Apply migrations (safe for production) |
| `npm run db:seed:demo` | Load the demo workspace |

## License

See [LICENSE.md](LICENSE.md).
