# Release test checklist

Run this on a **clean server** before every release and before submitting to a marketplace. Tick each line. When something fails, write down the page, what you did and the message you saw. Allow about two hours the first time.

Use a real Ubuntu server (or VM) with only Node.js 20+, PostgreSQL 14+, Redis 6.2+ and Nginx installed, exactly as a buyer would have. Do not reuse your development machine.

## 0. Before you start

- [ ] Server has no previous Sellora database or `.env` file.
- [ ] You are following docs/INSTALLATION.md and docs/DEPLOYMENT.md line by line, not from memory. Fix the guide if a step is wrong or missing.
- [ ] Have ready: a test email (SMTP) account, an OpenAI key, and test accounts for any gateway you will advertise (Stripe test keys, PayPal sandbox, SSLCOMMERZ sandbox, etc.).

## 1. Install

- [ ] `npm install` finishes without errors.
- [ ] `npm run build` finishes without errors.
- [ ] The site opens, and `/install` shows step 1 with every requirement green.
- [ ] Step 2: database is connected. (On a bare server, enter a wrong password and confirm the message is clear, then the right one.)
- [ ] Step 3: **Test email connection** says connected. **Test** next to the AI key says accepted. A wrong key shows a clear error.
- [ ] Step 4: **Create tables** succeeds. Run it a second time; it still succeeds and loses nothing.
- [ ] Step 5: administrator is created. A weak password, mismatched passwords and a bad email are all rejected with a clear message.
- [ ] Step 6 shows warnings only for real problems (for example `https://` without `COOKIE_SECURE`).
- [ ] Finish signs you in and **Open admin dashboard** opens `/admin` with no error.
- [ ] Open `/install` again: it is locked and offers sign-in.
- [ ] `pm2 restart all`, then reload: everything still works.

## 2. Accounts and security

- [ ] Sign out and sign in again. Wrong password shows an error and does not lock the page.
- [ ] Forgot password: the email arrives and the reset link works once, not twice.
- [ ] Register a second business from `/register`. Verify the email link.
- [ ] Invite a team member; they accept and see only what their role allows.
- [ ] As the second business, try to open the first business's pages by changing ids in the address bar: nothing from the other business is ever shown.
- [ ] Turn on two-factor sign-in and sign in with a code.
- [ ] Browser developer tools: no secret key or password appears in any page or response.

## 3. Platform admin

- [ ] `/admin` lists both businesses. Change a plan and suspend/reactivate a business.
- [ ] Plan payments tab: save payment instructions, currency and prices.
- [ ] As the second business, Billing → **Pay & upgrade** shows those details. Submit a payment with a transaction ID.
- [ ] Submitting the same transaction ID again is refused. A second pending payment is refused.
- [ ] As admin, **Approve**: the business is on the new plan and sees a notification and a renewal date a month away.
- [ ] Submit another and **Reject** with a reason: the business sees the reason.
- [ ] (Optional) Set a renewal date in the past directly in the database: after the 3 day grace period the business is on Free limits and Billing shows "expired".

## 4. Catalog and product import

- [ ] Add one product by hand with a photo. It appears in Products with stock.
- [ ] Import from a Shopify store link (try a public store): preview shows names, photos, prices, categories; import adds them with photos saved.
- [ ] Import from a WooCommerce store link, and again with API keys: keys with Read permission work, wrong keys show a clear message.
- [ ] Import from an Excel file, a CSV, a Word table and a text based PDF. Check name, SKU, price, sale price, image links and extra columns arrive correctly.
- [ ] Importing the same file again with "Skip" adds nothing; with "Update" changes prices but keeps stock.
- [ ] Import more products than the plan allows: it stops with an upgrade message and nothing breaks.
- [ ] Try pointing the importer at `http://localhost` or a private address: it must be refused.

## 5. AI agent

- [ ] Settings → AI → **Test connection** passes.
- [ ] Upload a knowledge document (PDF, Word, text) and add a web page.
- [ ] Open the agent **Playground**: ask about a product, about delivery policy, for a discount, for a person. Answers use your real products and policies; the human handoff works.
- [ ] In the Playground, create an order: it only describes what it would do (test mode), and no order exists afterwards.
- [ ] The dashboard checklist ticks items off as you finish them.

## 6. Channels

For each channel you advertise:

- [ ] **Website chat**: paste the one-line code into a test page; a visitor message reaches the inbox; the AI replies; a team reply reaches the visitor.
- [ ] **WhatsApp**: connect a test number; send and receive messages, delivery ticks update, templates sync.
- [ ] **Messenger** and **Instagram**: connect, receive and reply.
- [ ] Take over a chat from the AI; hand it back.
- [ ] Webhooks: add an endpoint, send a test event, check the signature on the receiving side, then break the endpoint and confirm retries and the delivery log.

## 7. Orders and payments

- [ ] Create an order in the dashboard and through a chat with the AI.
- [ ] Integrations → Payments: add a **manual** method (bank transfer) and a **gateway** you advertise.
- [ ] On an order, **Request payment** with the gateway: you get a link, the customer can pay in the gateway's test mode, and within seconds the order shows **Paid** and the customer is notified.
- [ ] Pay less than the amount, or in another currency, if the gateway allows it: the order must **not** be marked paid and the team gets an "amount needs review" notification.
- [ ] Replay the same webhook (use the gateway dashboard "resend"): the order is not paid twice.
- [ ] Send a webhook with a wrong signature (use curl): it is rejected.
- [ ] Manual method: request payment, then **Mark as paid**; it shows in Payments.
- [ ] Ask the AI in chat to pay for an order: it lists only valid methods and shares a real link or the written instructions, never invented ones.
- [ ] Refund a payment (recorded in Sellora; refund the money in the gateway itself).
- [ ] Create an invoice, download the PDF, add a delivery and update its status.

## 8. Everyday screens

- [ ] Dashboard, Inbox, Customers, Leads, Deals (drag a card), Tasks, Orders, Inventory (adjust stock), Analytics pages all load without errors with real data.
- [ ] Automation: create a workflow from a template, trigger it, read the run log.
- [ ] Notifications arrive in real time (open two browsers).
- [ ] Dark mode on every page above looks right.
- [ ] Phone width (390 px): sign in, inbox, orders and the import page are usable.
- [ ] Home page: menu links scroll to sections and leave no `#` in the address.

## 9. Operations

- [ ] `deploy.sh` runs on a second deploy without errors and without downtime longer than a few seconds.
- [ ] Backup script creates a backup; restore script restores it on a spare server.
- [ ] Stop Redis for a minute: the site shows a clear message instead of crashing, and recovers on its own.
- [ ] `pm2 logs` shows no repeating errors after 10 minutes of normal use.
- [ ] Run `npm run test` and `npm run test:integration` (needs the test database and Redis) and `npm run lint`: all pass.

## 10. Marketplace package

- [ ] Remove the `node_modules`, `.next`, `dist`, `.env` and any logs from the zip. Check the zip contains `.env.example` but no real `.env`.
- [ ] Demo data seeded with `npm run db:seed:demo` on the demo site; demo login is in the item description, and the demo cannot be broken or abused (consider resetting it nightly).
- [ ] CHANGELOG.md, LICENSE.md, README.md and docs/ are up to date. docs/THIRD_PARTY_LICENSES.md was regenerated.
- [ ] Item description lists exactly what was tested. Do not advertise a gateway or channel you did not test end to end.
- [ ] Screenshots (sign-in, dashboard, inbox, AI agent, import, payments, admin) and a 1–2 minute video.
- [ ] A support plan: where buyers send questions, and your response time.
