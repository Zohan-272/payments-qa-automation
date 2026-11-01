import { expect, test } from '@playwright/test';

async function fillCard(page: import('@playwright/test').Page, number: string, expiry = '12/34', cvc = '123') {
  await page.getByLabel('Card number').fill(number);
  await page.getByLabel('Expiry (MM/YY)').fill(expiry);
  await page.getByLabel('CVC').fill(cvc);
}

test.describe('Checkout page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: 'Demo checkout' })).toBeVisible();
  });

  test('successful card payment shows success and the order becomes paid via webhook @smoke', async ({ page }) => {
    await fillCard(page, '4242 4242 4242 4242');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();

    await expect(page).toHaveURL(/\/checkout\/result\?payment_intent=pi_/);
    await expect(page.getByRole('status')).toHaveText('Payment succeeded');
    await expect(page.locator('#order-status')).toHaveText('Order status: paid');
  });

  test('declined card shows the error and keeps the user on the checkout page', async ({ page }) => {
    await fillCard(page, '4000 0000 0000 0002');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();

    await expect(page.getByRole('alert')).toHaveText('Your card was declined.');
    await expect(page).toHaveURL(/\/checkout$/);
  });

  test('insufficient funds shows a specific message', async ({ page }) => {
    await fillCard(page, '4000 0000 0000 9995');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();
    await expect(page.getByRole('alert')).toHaveText('Your card has insufficient funds.');
  });

  test('3DS: completing authentication leads to a paid order', async ({ page }) => {
    await fillCard(page, '4000 0025 0000 3155');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();

    await expect(page).toHaveURL(/\/3ds\/pi_/);
    await expect(page.getByRole('heading', { name: 'Bank authentication' })).toBeVisible();
    await page.getByRole('button', { name: 'Complete authentication' }).click();

    await expect(page.getByRole('status')).toHaveText('Payment succeeded');
    await expect(page.locator('#order-status')).toHaveText('Order status: paid');
  });

  test('3DS: failing authentication shows a failed payment', async ({ page }) => {
    await fillCard(page, '4000 0025 0000 3155');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();
    await expect(page).toHaveURL(/\/3ds\/pi_/);
    await page.getByRole('button', { name: 'Fail authentication' }).click();

    await expect(page.getByRole('status')).toContainText('Payment failed: The provided payment method failed authentication.');
    await expect(page.locator('#order-status')).toHaveText('Order status: payment_failed');
  });

  test.describe('client-side validation', () => {
    test('empty card number', async ({ page }) => {
      await page.getByRole('button', { name: 'Pay $20.00' }).click();
      await expect(page.getByRole('alert')).toHaveText('Enter a card number.');
    });

    test('malformed expiry', async ({ page }) => {
      await fillCard(page, '4242424242424242', '1234');
      await page.getByRole('button', { name: 'Pay $20.00' }).click();
      await expect(page.getByRole('alert')).toHaveText('Enter the expiry as MM/YY.');
    });

    test('malformed CVC', async ({ page }) => {
      await fillCard(page, '4242424242424242', '12/34', '1');
      await page.getByRole('button', { name: 'Pay $20.00' }).click();
      await expect(page.getByRole('alert')).toHaveText('Enter a valid CVC.');
    });
  });

  test('server-side validation: card number failing the Luhn check is rejected', async ({ page }) => {
    await fillCard(page, '4242424242424241');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();
    await expect(page.getByRole('alert')).toHaveText('Your card number is incorrect.');
  });

  test('a declined card can be corrected and the next attempt succeeds', async ({ page }) => {
    await fillCard(page, '4000000000000002');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();
    await expect(page.getByRole('alert')).toHaveText('Your card was declined.');

    await page.getByLabel('Card number').fill('4242424242424242');
    await page.getByRole('button', { name: 'Pay $20.00' }).click();
    await expect(page.getByRole('status')).toHaveText('Payment succeeded');
  });
});
