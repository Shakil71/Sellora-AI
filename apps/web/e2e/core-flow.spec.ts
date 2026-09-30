import { expect, test } from '@playwright/test';

/** Register → Create workspace → Add product → Create customer → Create order → View dashboard */
test('core commerce flow', async ({ page }, testInfo) => {
  const id = `${Date.now()}${testInfo.project.name}`;
  const sku = `E2E-${id}`;

  await page.goto('/register');
  await page.fill('#name', 'E2E Owner');
  await page.fill('#workspaceName', `E2E Shop ${id}`);
  await page.fill('#email', `e2e-${id}@test.local`);
  await page.fill('#password', 'Passw0rd123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/onboarding');
  await expect(page.getByRole('heading', { name: 'Tell us about your business' })).toBeVisible();

  // Product
  await page.goto('/products/new');
  await page.fill('#p-name', 'E2E Headphones');
  await page.fill('#p-sku', sku);
  await page.fill('#p-price', '99.5');
  await page.fill('#p-stock', '10');
  await page.getByRole('button', { name: 'Create product' }).click();
  await page.waitForURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'E2E Headphones' })).toBeVisible();

  // Customer
  await page.goto('/customers?new=1');
  await page.fill('#c-name', 'E2E Customer');
  await page.fill('#c-wa', '+14155550199');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}$/);

  // Order
  await page.getByRole('link', { name: 'New order' }).click();
  await page.waitForURL(/\/orders\/new/);
  await page.getByRole('combobox').filter({ hasText: 'Select product' }).click();
  await page.getByPlaceholder('Search products or SKU').fill(sku);
  await page.getByRole('option', { name: /E2E Headphones/ }).click();
  await expect(page.getByText('Total', { exact: true })).toBeVisible();
  await expect(page.getByText('$99.50').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create order' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByText('E2E Headphones').first()).toBeVisible();

  // Dashboard reflects the order
  await page.goto('/dashboard');
  await expect(page.getByText('Recent orders')).toBeVisible();
  await expect(page.getByText('E2E Customer').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
