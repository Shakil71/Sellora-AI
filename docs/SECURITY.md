# Security

No website can be made impossible to hack, and anyone who promises that is wrong. What a secure product does is make attacks hard, limit the damage when something goes wrong, and make problems visible. This page lists what Sellora AI does, what **you** must do on your server, and how to report a problem.

## What the application already does

**Sign-in and sessions**
- Passwords are stored as Argon2id hashes (never readable). Minimum 10 characters, with a letter and a number; common passwords such as "Password123" are refused.
- Short-lived access tokens (15 minutes) in HttpOnly cookies that scripts cannot read. Refresh tokens rotate on every use; reusing an old one revokes the whole session family (stolen-token detection).
- Accounts lock for a few minutes after repeated wrong passwords. Sign-in, sign-up and reset endpoints have strict rate limits, and the sample Nginx file adds a second layer.
- Two-factor authentication (authenticator app) for any user.
- A CSRF token is required on every state-changing request made from the browser.
- Changing or resetting a password signs the user out everywhere.

**Data separation and permissions**
- Every business ("workspace") is isolated: each database query is scoped to the signed-in workspace. Fine-grained roles and permissions decide who can see or change what. API keys carry only the permissions you give them.
- Platform administration is limited to super administrators.
- Audit log of sign-ins, plan and payment changes, imports, role changes and more. Secrets are scrubbed from the log.

**Protecting stored secrets**
- WhatsApp, Meta, payment gateway and AI keys and 2FA secrets are encrypted with AES-256-GCM using `ENCRYPTION_KEY` before they reach the database and are never sent back to the browser.
- Webhook signatures from WhatsApp, Meta, Stripe, PayPal, Razorpay, Paystack and others are verified; payments are only marked paid after verification and an amount/currency check.

**Input and output safety**
- All database access goes through Prisma's parameterized queries (no string-built SQL). Every request body is validated with a strict schema.
- Uploaded files are identified by their real contents, not their name; only images, PDFs and Office documents are accepted. Files are served with `nosniff` and a sandboxing Content-Security-Policy.
- Anything the app fetches from a web address you supply (knowledge pages, webhooks, product import) is blocked from reaching private or internal networks (SSRF protection).
- Browsers get a strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, and a locked-down Referrer and Permissions policy. The API itself sends `default-src 'none'`.

**The installer**
- Until installation finishes, `/install` requires a secret token (from `INSTALLER_TOKEN`, or a random one saved to `storage/install-token.txt` and printed in the API log). A stranger who finds a fresh site cannot create the administrator. After installation it locks permanently and the token file is deleted.

## What you must do on the server

The setup script `deploy/scripts/setup-server.sh` does most of this for you. If you set up manually, do all of it.

1. **HTTPS only.** Get a certificate with certbot and use `deploy/nginx/sellora-https.example.conf` (TLS 1.2/1.3 only, HSTS, redirect from HTTP). Then set `COOKIE_SECURE=true`, `TRUST_PROXY=true` and https URLs in `.env`.
2. **Keep the database private.** PostgreSQL must listen on `localhost` only, with a long random password (the script generates one). Never open port 5432 or 6379 in the firewall. Redis must have `requirepass` (the script sets it).
3. **Firewall.** Only SSH, HTTP and HTTPS reachable from outside (`ufw`, set by the script). Prefer SSH keys, disable SSH password login and root login, and consider changing SSH to a non-default port.
4. **Brute-force blocking and updates.** `fail2ban` and automatic security updates (`unattended-upgrades`) are installed by the script. Reboot after kernel updates.
5. **Protect `.env`.** It holds every secret: mode 600, owned by the deploy user, never committed or emailed. Keep `ENCRYPTION_KEY` backed up separately: without it, stored gateway keys cannot be decrypted.
6. **Encrypted backups.** Set `BACKUP_PASSPHRASE` (the script generates one). Backups are AES-256 encrypted before they touch the disk. Copy the passphrase to a password manager and copy backups off the server regularly. Test a restore (docs/RELEASE_TEST_CHECKLIST.md).
7. **Disk encryption.** Use an encrypted disk or volume at your hosting provider so a stolen disk or snapshot is unreadable.
8. **Turn on two-factor sign-in** for every administrator, especially the platform owner (Settings → Security).
9. **Update dependencies** before every release: `npm audit --omit=dev`, then `npm update` and test. Review the list in docs/THIRD_PARTY_LICENSES.md.
10. **Watch the logs.** `pm2 logs`, `/var/log/nginx/sellora.error.log`, `fail2ban-client status`, and the Audit log in the app. Unexpected sign-ins or repeated 401/403 responses deserve a look.

## Known and accepted dependency notices

`npm audit --omit=dev` currently reports these. None is reachable by a visitor:
- `prisma` / `@prisma/config` / `deepmerge-ts`: part of the Prisma command-line tool used at deploy time, not by the running server.
- `uuid` (through `exceljs`): the bounds check issue only affects generating v3/v5/v6 ids into a caller-supplied buffer, which ExcelJS does not do.
- `file-type`: a malformed Windows media (ASF) header can hang it. Sellora refuses those files before calling the library.

## Reporting a vulnerability

Email the address in your product listing with the steps to reproduce. Please do not test against other people's installations or publish details before a fix is available. Fixes are announced in CHANGELOG.md.
