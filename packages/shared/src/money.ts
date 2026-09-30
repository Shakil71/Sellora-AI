/**
 * Order money calculations. All math is done in integer minor units (cents)
 * to avoid floating point drift, then converted back to decimals.
 */
export interface OrderLineInput {
  unitPrice: number;
  quantity: number;
  /** Absolute discount for the whole line */
  discount?: number;
}

export interface OrderTotalsInput {
  items: OrderLineInput[];
  /** Absolute order-level discount */
  orderDiscount?: number;
  shipping?: number;
  /** Tax rate in percent, e.g. 7.5 for 7.5% — applied after discounts, before shipping */
  taxRatePercent?: number;
}

export interface OrderLineTotal {
  subtotal: number;
  discount: number;
  total: number;
}

export interface OrderTotals {
  lines: OrderLineTotal[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal: number;
  total: number;
}

export const toMinor = (value: number): number => Math.round((Number(value) || 0) * 100);
export const fromMinor = (value: number): number => Math.round(value) / 100;

export function calculateOrderTotals(input: OrderTotalsInput): OrderTotals {
  if (input.items.length === 0) {
    throw new Error('An order needs at least one item');
  }
  let subtotalMinor = 0;
  let lineDiscountMinor = 0;
  const lines = input.items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('Quantity must be a positive whole number');
    }
    if (item.unitPrice < 0) throw new Error('Unit price cannot be negative');
    const lineSubtotal = toMinor(item.unitPrice) * item.quantity;
    const lineDiscount = Math.min(toMinor(item.discount ?? 0), lineSubtotal);
    if (lineDiscount < 0) throw new Error('Discount cannot be negative');
    subtotalMinor += lineSubtotal;
    lineDiscountMinor += lineDiscount;
    return {
      subtotal: fromMinor(lineSubtotal),
      discount: fromMinor(lineDiscount),
      total: fromMinor(lineSubtotal - lineDiscount),
    };
  });

  const afterLineDiscounts = subtotalMinor - lineDiscountMinor;
  const orderDiscountMinor = Math.min(toMinor(input.orderDiscount ?? 0), afterLineDiscounts);
  if (orderDiscountMinor < 0) throw new Error('Discount cannot be negative');
  const discountMinor = lineDiscountMinor + orderDiscountMinor;
  const taxableMinor = subtotalMinor - discountMinor;
  const rate = input.taxRatePercent ?? 0;
  if (rate < 0 || rate > 100) throw new Error('Tax rate must be between 0 and 100');
  const taxMinor = Math.round((taxableMinor * rate) / 100);
  const shippingMinor = toMinor(input.shipping ?? 0);
  if (shippingMinor < 0) throw new Error('Shipping cannot be negative');

  return {
    lines,
    subtotal: fromMinor(subtotalMinor),
    discountTotal: fromMinor(discountMinor),
    taxTotal: fromMinor(taxMinor),
    shippingTotal: fromMinor(shippingMinor),
    total: fromMinor(taxableMinor + taxMinor + shippingMinor),
  };
}

export function formatMoney(value: number | string, currency = 'USD', locale = 'en-US'): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount || 0);
  } catch {
    return `${currency} ${(amount || 0).toFixed(2)}`;
  }
}
