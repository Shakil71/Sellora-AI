import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrderTotals } from './money';
import { SYSTEM_ROLES, ALL_PERMISSIONS } from './permissions';
import { isWithinLimit, UNLIMITED } from './plans';

test('calculates totals with line discount, order discount, tax and shipping', () => {
  const t = calculateOrderTotals({
    items: [
      { unitPrice: 19.99, quantity: 3, discount: 5 },
      { unitPrice: 0.1, quantity: 3 },
    ],
    orderDiscount: 2,
    shipping: 4.5,
    taxRatePercent: 10,
  });
  assert.equal(t.subtotal, 60.27);
  assert.equal(t.discountTotal, 7);
  assert.equal(t.taxTotal, 5.33);
  assert.equal(t.shippingTotal, 4.5);
  assert.equal(t.total, 63.1);
});

test('discount never exceeds subtotal', () => {
  const t = calculateOrderTotals({ items: [{ unitPrice: 10, quantity: 1, discount: 50 }] });
  assert.equal(t.total, 0);
});

test('rejects invalid quantities', () => {
  assert.throws(() => calculateOrderTotals({ items: [{ unitPrice: 10, quantity: 0 }] }));
  assert.throws(() => calculateOrderTotals({ items: [{ unitPrice: 10, quantity: 1.5 }] }));
  assert.throws(() => calculateOrderTotals({ items: [] }));
});

test('owner has every permission and viewer has no write permission', () => {
  assert.deepEqual([...SYSTEM_ROLES.OWNER.permissions].sort(), [...ALL_PERMISSIONS].sort());
  assert.ok(SYSTEM_ROLES.VIEWER.permissions.every((p) => p.endsWith('.view')));
  assert.ok(!SYSTEM_ROLES.ADMIN.permissions.includes('billing.manage'));
});

test('usage limits', () => {
  assert.equal(isWithinLimit(UNLIMITED, 1e9), true);
  assert.equal(isWithinLimit(5, 4), true);
  assert.equal(isWithinLimit(5, 5), false);
});
