# Setting up your AI sales agent

A guide for business owners. Allow about 30 minutes. The dashboard shows a **Get ready to sell** checklist that ticks off each step below as you finish it.

## 1. Connect the AI (Settings → AI)

1. Create an API key at your AI provider (OpenAI, or any OpenAI-compatible service).
2. Paste it into **Settings → AI** and press **Save**, then **Test connection**.
3. Keep the default models unless you have a reason to change them.

The key is encrypted and never shown again. Without a key the AI cannot reply, and every conversation goes to your team.

## 2. Add your products (Products)

The AI only quotes prices and stock it finds in your catalog. Add each product with a name, price and stock. Good descriptions help it recommend the right item.

## 3. Teach it your business (AI → Knowledge base)

Upload the documents customers ask about: delivery times and fees, return and refund policy, warranty, opening hours, FAQs. PDF, Word, text, Markdown and web page addresses work. Write short, plain sentences; the AI answers from this text.

## 4. Set the house rules (AI → AI instructions)

Rules that apply to every agent, for example:
- "Never offer discounts. Send discount requests to the team."
- "Reply in the language the customer writes in."

## 5. Set up your agent (AI → AI Agents)

Open the Sales Assistant (or create a new agent) and review:

| Setting | What to do |
| --- | --- |
| Tone and language | Pick how it speaks. "Auto" replies in the customer's language. |
| Business info | A short description: what you sell, where you deliver. |
| Escalation rules | When to hand over to a person: complaints, refunds, custom prices. |
| Working hours | Optional. Outside these hours it uses the fallback below. |
| Fallback | Hand over to your team, send a fixed message, or stay silent. |
| Tools | What the AI may do: search products, check stock, place orders, create leads, send payment links. Turn off anything you do not want. |
| Knowledge | Which knowledge bases it may use. |

Orders are only placed after the customer confirms the summary.

### Test before going live

Use the **Playground** on the agent page. It runs in test mode: the AI shows what it would do, but no orders or payments are created. Try real questions your customers ask, an order, and a refund complaint.

## 6. Connect where customers write (Integrations)

Connect at least one channel, otherwise the agent receives no messages:
- **WhatsApp**: needs a WhatsApp Business account approved by Meta (this can take days; start early).
- **Website chat**: paste one line of code into your site.
- **Messenger** and **Instagram**: connect your Facebook Page.

## 7. Choose how customers pay (Integrations → Payments)

Add the payment methods you accept, such as a gateway, bKash, Nagad, bank transfer or cash on delivery, and limit each to the countries and currencies it suits. Then, in your agent's tools, make sure **Payment options** and **Send payment link** are on so the AI can send payment details in the chat. See the payment section of the main documentation for each gateway.

## 8. Go live and watch

- Open **Inbox** and read the first real conversations. You can take over any chat at any time; replying pauses the AI for that customer.
- Check **AI → Usage** to see how many AI messages you use against your plan.
- When the AI gets something wrong, fix the cause: add the missing fact to the knowledge base or a rule to the instructions.
