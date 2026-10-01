# Changelog

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
