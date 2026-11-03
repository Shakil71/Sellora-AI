# Changelog

## Unreleased

### Security
- **Platform AI key could leak to a workspace-chosen URL.** A workspace that set a custom AI base URL without its own key had the platform `OPENAI_API_KEY` sent to that URL. The platform key now only goes to `OPENAI_BASE_URL`; a custom URL is used only with the workspace's own key, must be a public address, and may not redirect.
- **Cross-workspace message injection through webhooks.** A WhatsApp, Messenger or Instagram webhook signed with one workspace's app secret could carry entries for another workspace's number or page. A workspace's secret now only vouches for its own numbers and pages; other entries are dropped. Batches for several workspaces are stored as one event per workspace, so no workspace's webhook log shows another's messages.
- The private-address check now also refuses IPv4 addresses embedded in IPv6 (`::ffff:…`, NAT64).
- One-time links (email verification, password reset, invitations) cannot be used twice by simultaneous requests.

### Fixed
- The installer no longer corrupts `.env` values containing `$`, quotes, backslashes or line breaks; the deploy, backup and restore scripts read every quoting style dotenv accepts.
- Two simultaneous status changes on the same order can no longer release or restock inventory twice.
- The platform admin queue view now includes the integrations queue (Messenger/Instagram webhooks, outgoing webhooks).
- Home page structured data is escaped.

## 1.1.0

### Added
- **Payment methods per business** (Integrations → Payments): Stripe, PayPal, Razorpay, Paystack, SSLCOMMERZ, any provider through a payment link, and manual methods (bKash, Nagad, UPI, M-Pesa, bank transfer, cash on delivery), limited by country and currency. Verified gateway webhooks mark orders paid.
- **Payment links from orders and from the AI agent** (new tools: payment options, send payment link).
- **Plan billing without a gateway**: customers pay the platform owner by bKash, Nagad or bank transfer and submit the transaction ID; the platform admin approves it for a month, with renewal and grace period.
- **Product import**: from a store link (Shopify and WooCommerce auto-detected, other sites via product-page data), WooCommerce API keys, any JSON/XML/CSV feed or API, or an uploaded Excel, CSV, Word, PDF, JSON or XML file. Preview, then batched import with photos, SKUs, prices, categories, stock and details.
- Dashboard "Get ready to sell" checklist and an AI setup guide for business owners (docs/AI_SETUP.md).
- Redesigned installer and sign-in pages (animated WhatsApp + AI showcase), installer email and AI-key tests, automatic sign-in after install.

### Added (continued)
- **Editable home page** (Platform admin → Edit home page): the platform owner can change the brand name, headline, buttons, feature cards, steps, security and AI points, FAQ, testimonials, footer and search-engine text; add, delete, reorder or hide sections. Plan prices on the home page follow Platform admin → Plan payments.

- Step-by-step **Installation Guide** (docs/Sellora-AI-Installation-Guide.docx) for VPS, cloud, cPanel and local installs, including how to find the installer token.
- `deploy.sh` and `setup-server.sh` now work from a downloaded ZIP (no git needed).

### Security
- Installer now requires a secret token (generated automatically if you do not set one), closing a takeover window on fresh installs.
- Stronger passwords: 10+ characters and a list of common passwords is refused.
- Content-Security-Policy, cross-origin and HSTS headers for the web app and API; hardened HTTPS Nginx example with sign-in rate limits.
- Encrypted database backups (`BACKUP_PASSPHRASE`), Redis password, fail2ban and automatic security updates in the server setup script.
- Updated nodemailer to 10.x (fixes several advisories) and guarded uploads against a file-type parser hang.
- New docs/SECURITY.md.

### Changed
- Home page menu links scroll to sections without leaving `#section` in the address bar.

### Database
- New migrations: `payment_methods`, `plan_payments`. Run `npm run db:deploy` when upgrading.

## 1.0.0
- Initial release: AI sales agent, WhatsApp, website chat, Messenger and Instagram inbox, CRM, catalog, inventory, orders, invoices, deliveries, automation, analytics, webhooks and API.
