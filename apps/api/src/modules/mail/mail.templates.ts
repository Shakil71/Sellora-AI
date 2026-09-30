import { env } from '../../config/env';

export type MailTemplate =
  | 'welcome'
  | 'verify-email'
  | 'password-reset'
  | 'order-confirmation'
  | 'payment-confirmation'
  | 'team-invitation'
  | 'workflow-notification';

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<tr><td style="padding:8px 0 24px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;font-size:14px">${escapeHtml(cta.label)}</a></td></tr>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px">
<tr><td style="padding-bottom:24px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:32px;height:32px;background:#0f766e;border-radius:8px;color:#fff;font-weight:700;text-align:center;font-size:18px">S</td>
<td style="padding-left:10px;font-weight:700;font-size:16px;letter-spacing:-0.01em">${escapeHtml(env.APP_NAME)}</td></tr></table></td></tr>
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#3f3f46;padding-bottom:16px">${bodyHtml}</td></tr>
${button}
<tr><td style="border-top:1px solid #e4e4e7;padding-top:16px;font-size:12px;color:#71717a">You received this email because of activity on your ${escapeHtml(env.APP_NAME)} account.</td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(items: Array<{ name: string; quantity: number; total: string }>) {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #f4f4f5">${escapeHtml(i.name)} × ${escapeHtml(i.quantity)}</td><td align="right" style="padding:6px 0;border-bottom:1px solid #f4f4f5">${escapeHtml(i.total)}</td></tr>`,
    )
    .join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:12px 0">${rows}</table>`;
}

export function renderMail(template: MailTemplate, data: Record<string, unknown>): { subject: string; html: string; text: string } {
  const name = escapeHtml(data.name ?? 'there');
  switch (template) {
    case 'welcome':
      return {
        subject: `Welcome to ${env.APP_NAME}`,
        html: layout(
          `Welcome, ${name}!`,
          `Your workspace <strong>${escapeHtml(data.workspace)}</strong> is ready. Connect WhatsApp, add your products and let your AI Sales Agent start converting conversations into revenue.`,
          { label: 'Open dashboard', url: `${env.APP_URL}/dashboard` },
        ),
        text: `Welcome to ${env.APP_NAME}. Open ${env.APP_URL}/dashboard to get started.`,
      };
    case 'verify-email':
      return {
        subject: 'Verify your email address',
        html: layout(
          'Confirm your email',
          `Hi ${name}, please confirm your email address to secure your account. This link expires in 24 hours.`,
          { label: 'Verify email', url: String(data.url) },
        ),
        text: `Verify your email: ${data.url}`,
      };
    case 'password-reset':
      return {
        subject: 'Reset your password',
        html: layout(
          'Reset your password',
          `Hi ${name}, we received a request to reset your password. This link expires in 1 hour. If you did not request this, you can safely ignore this email.`,
          { label: 'Reset password', url: String(data.url) },
        ),
        text: `Reset your password: ${data.url}`,
      };
    case 'team-invitation':
      return {
        subject: `You're invited to join ${data.workspace} on ${env.APP_NAME}`,
        html: layout(
          `Join ${escapeHtml(data.workspace)}`,
          `${escapeHtml(data.inviter)} invited you to join <strong>${escapeHtml(data.workspace)}</strong> as <strong>${escapeHtml(data.role)}</strong>. The invitation expires in 7 days.`,
          { label: 'Accept invitation', url: String(data.url) },
        ),
        text: `Accept your invitation: ${data.url}`,
      };
    case 'order-confirmation':
      return {
        subject: `Order ${data.number} confirmed`,
        html: layout(
          `Thanks for your order, ${name}`,
          `Order <strong>${escapeHtml(data.number)}</strong> has been received.${itemsTable((data.items as Array<{ name: string; quantity: number; total: string }>) ?? [])}<strong>Total: ${escapeHtml(data.total)}</strong>`,
        ),
        text: `Order ${data.number} confirmed. Total ${data.total}.`,
      };
    case 'payment-confirmation':
      return {
        subject: `Payment received for ${data.number}`,
        html: layout('Payment received', `We received your payment of <strong>${escapeHtml(data.amount)}</strong> for order <strong>${escapeHtml(data.number)}</strong>. Thank you!`),
        text: `Payment of ${data.amount} received for ${data.number}.`,
      };
    case 'workflow-notification':
      return {
        subject: String(data.title ?? 'Workflow notification'),
        html: layout(String(data.title ?? 'Workflow notification'), escapeHtml(data.body ?? ''), data.url ? { label: 'Open', url: String(data.url) } : undefined),
        text: `${data.title}\n\n${data.body ?? ''}`,
      };
  }
}
