# CodeCanyon upload guide

This folder is for you (the author), not for buyers. It is left out of the buyer ZIP (`.gitattributes` → `export-ignore`).

## 1. Build the upload files

From the project folder, after committing your changes:

```powershell
powershell -ExecutionPolicy Bypass -File marketplace\build-package.ps1
```

Everything lands in `marketplace\dist\upload`:

| File | CodeCanyon upload field |
| --- | --- |
| `thumbnail-80x80.png` | Thumbnail (80×80, under 50 KB) |
| `inline-preview-590x300.png` | Inline Preview Image (590×300) |
| `Sellora-AI-v<version>.zip` | Main File(s): the buyer download |
| `screenshots.zip` | Screenshots / preview images (14 PNG files, light and dark) |
| `item-description.html` | Paste into the Description box (the editor accepts this HTML) |

The main ZIP contains `sellora-ai.zip` (source from `git archive`: no `.env`, `node_modules`, builds, logs or uploads), `Documentation/` (HTML docs plus the Word installation guide), `Licensing/` and `README.txt`.

## 2. Upload form

On author.envato.com, go to **Upload** → **CodeCanyon**.

| Field | Value |
| --- | --- |
| Category | JavaScript, then the closest subcategory offered. This is a Node.js (Next.js + NestJS) application, not a PHP script. |
| Name | `Sellora AI - AI Sales Agent, Inbox & CRM SaaS for WhatsApp` |
| Key features (if asked) | AI sales agent with tools · WhatsApp, website chat, Messenger, Instagram inbox · CRM and orders · Payments incl. bKash/Nagad · Multi-tenant SaaS with plans |
| Tags (max 15) | `whatsapp`, `ai chatbot`, `ai sales agent`, `chatgpt`, `openai`, `crm`, `saas`, `multi tenant`, `live chat`, `omnichannel`, `ecommerce`, `order management`, `automation`, `nextjs`, `nestjs` |
| Compatible browsers | Chrome, Firefox, Safari, Edge |
| Software version / framework | Node.js 20+, Next.js 16, NestJS 11, PostgreSQL 14+, Redis |
| Files included | JavaScript JS, CSS, HTML, JSON, SQL (TypeScript source) |
| High resolution | Yes |
| Documentation | Well documented |
| Layout | Responsive |
| Demo URL | `http://27.147.147.228:8090` (see section 3) |
| Price | Envato reviews it and may suggest a price |

### Message to the reviewer (example)

> Sellora AI is a self-hosted Node.js SaaS (Next.js 16 + NestJS 11, PostgreSQL, Redis). Installation on Ubuntu is automated by `deploy/scripts/setup-server.sh` and `deploy.sh`; the full steps are in Documentation/index.html. Demo login: demo@sellora.test / SelloraDemo2026 (demo workspace, data resets daily). Product screenshots use fictional demo data. WhatsApp, Messenger and Instagram use Meta's official APIs; no Meta logos are used.

## 3. Before you submit: still to do

1. **Public demo: done.** `http://27.147.147.228:8090` (router port 8090 → server 192.168.197.100:80) runs the demo workspace, login `demo@sellora.test` / `SelloraDemo2026`. `/opt/sellora-ai/demo/reset-demo.sh` restores it from `snapshot.dump`; schedule it every 3 hours in the `sellora` user's crontab:
   ```
   0 */3 * * * /opt/sellora-ai/demo/reset-demo.sh >> /opt/sellora-ai/logs/demo-reset.log 2>&1
   ```
   The reset wipes everything created since the snapshot, so never use this server for real customers. After deliberate changes (for example a new admin password), save them with `/opt/sellora-ai/demo/snapshot-demo.sh`. A domain with HTTPS looks more trustworthy to reviewers than a bare IP and port.
2. **Envato author account.** Have your tax information and payout method in place, and your author profile filled in.
3. **Support policy.** Decide whether you offer support (the docs say: through the item's Support tab) and set it on the item page.
4. **Check the main ZIP once.** Unzip it on a clean Ubuntu VPS and follow Documentation/index.html → section 4 from start to finish.

## 4. For each update

1. Bump `version` in `package.json` (also `apps/*/package.json`, `packages/shared/package.json` and the matching lines in `package-lock.json`), and add a section to `CHANGELOG.md`.
2. Update the changelog section in `marketplace/documentation/index.html` and `marketplace/listing/description.html`.
3. Commit, run the build script, and upload the new main ZIP as an update on the item page.
