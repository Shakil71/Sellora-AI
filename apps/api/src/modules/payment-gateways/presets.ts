/**
 * One-click starting points for manual payment methods. The owner can edit
 * the wording; `{order_number}` and `{amount}` are filled in per order.
 */
export interface ManualPreset {
  key: string;
  name: string;
  regions: string[];
  countries: string[];
  instructions: string;
}

export const MANUAL_PRESETS: ManualPreset[] = [
  {
    key: 'cash_on_delivery',
    name: 'Cash on delivery',
    regions: ['Global'],
    countries: [],
    instructions: 'Pay {amount} in cash to the delivery person when your order {order_number} arrives.',
  },
  {
    key: 'bank_transfer',
    name: 'Bank transfer',
    regions: ['Global'],
    countries: [],
    instructions: 'Transfer {amount} to:\nBank: ______\nAccount name: ______\nAccount number: ______\nUse {order_number} as the payment reference and send us the receipt.',
  },
  {
    key: 'bkash',
    name: 'bKash',
    regions: ['Bangladesh'],
    countries: ['BD'],
    instructions: 'Send {amount} by bKash “Send Money” to 01XXXXXXXXX (Personal).\nUse {order_number} as the reference and reply with the Transaction ID (TrxID).',
  },
  {
    key: 'nagad',
    name: 'Nagad',
    regions: ['Bangladesh'],
    countries: ['BD'],
    instructions: 'Send {amount} by Nagad “Send Money” to 01XXXXXXXXX (Personal).\nUse {order_number} as the reference and reply with the Transaction ID.',
  },
  {
    key: 'rocket',
    name: 'Rocket',
    regions: ['Bangladesh'],
    countries: ['BD'],
    instructions: 'Send {amount} by Rocket to 01XXXXXXXXX-X.\nUse {order_number} as the reference and reply with the Transaction ID.',
  },
  {
    key: 'upi',
    name: 'UPI',
    regions: ['India'],
    countries: ['IN'],
    instructions: 'Pay {amount} to the UPI ID yourname@bank (GPay, PhonePe, Paytm or any UPI app).\nAdd {order_number} in the note and send us a screenshot.',
  },
  {
    key: 'mpesa',
    name: 'M-Pesa',
    regions: ['Kenya', 'Tanzania'],
    countries: ['KE', 'TZ'],
    instructions: 'Go to M-Pesa → Lipa na M-Pesa → Paybill.\nBusiness no: ______  Account no: {order_number}\nAmount: {amount}',
  },
  {
    key: 'gcash',
    name: 'GCash',
    regions: ['Philippines'],
    countries: ['PH'],
    instructions: 'Send {amount} by GCash to 09XX XXX XXXX.\nPut {order_number} in the message and send us the reference number.',
  },
  {
    key: 'easypaisa',
    name: 'Easypaisa / JazzCash',
    regions: ['Pakistan'],
    countries: ['PK'],
    instructions: 'Send {amount} to Easypaisa / JazzCash account 03XX XXXXXXX.\nUse {order_number} as the reference and send us the transaction ID.',
  },
  {
    key: 'wise',
    name: 'Wise / international transfer',
    regions: ['Global'],
    countries: [],
    instructions: 'Send {amount} with Wise or an international bank transfer to:\nName: ______\nIBAN / account: ______\nSWIFT / BIC: ______\nReference: {order_number}',
  },
  {
    key: 'cash',
    name: 'Cash in store',
    regions: ['Global'],
    countries: [],
    instructions: 'Pay {amount} in cash when you collect order {order_number}.',
  },
  {
    key: 'card_terminal',
    name: 'Card (terminal)',
    regions: ['Global'],
    countries: [],
    instructions: 'Pay {amount} by card on delivery or at our store.',
  },
];

export function renderInstructions(template: string, vars: { order_number: string; amount: string }): string {
  return template.replace(/\{(order_number|amount)\}/g, (_m, k: 'order_number' | 'amount') => vars[k]);
}
