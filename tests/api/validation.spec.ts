import { test, expect } from '../support/fixtures';

test.describe('Amount validation', () => {
  const invalidAmounts: Array<[string, unknown, string]> = [
    ['zero', 0, 'amount_invalid'],
    ['negative', -500, 'amount_invalid'],
    ['decimal', 20.5, 'amount_invalid'],
    ['numeric string', '2000', 'amount_invalid'],
    ['boolean', true, 'amount_invalid'],
    ['below the minimum (49)', 49, 'amount_too_small'],
    ['above the maximum', 100_000_000, 'amount_too_large'],
  ];

  for (const [name, amount, code] of invalidAmounts) {
    test(`rejects ${name} amount with ${code}`, async ({ api }) => {
      const res = await api.createIntent({ amount, currency: 'usd' });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toMatchObject({ code, param: 'amount' });
    });
  }

  test('rejects a missing amount', async ({ api }) => {
    const res = await api.createIntent({ currency: 'usd' });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: 'parameter_missing', param: 'amount' });
  });

  test('accepts the boundary amounts 50 and 99,999,999', async ({ api }) => {
    for (const amount of [50, 99_999_999]) {
      const res = await api.createIntent({ amount, currency: 'usd' });
      expect(res.status(), `amount ${amount}`).toBe(201);
      expect((await res.json()).amount).toBe(amount);
    }
  });
});

test.describe('Currency validation', () => {
  for (const currency of ['usd', 'eur', 'gbp', 'jpy']) {
    test(`accepts supported currency ${currency}`, async ({ api }) => {
      const res = await api.createIntent({ amount: 1000, currency });
      expect(res.status()).toBe(201);
      expect((await res.json()).currency).toBe(currency);
    });
  }

  test('normalises currency codes to lowercase', async ({ api }) => {
    const res = await api.createIntent({ amount: 1000, currency: 'EUR' });
    expect(res.status()).toBe(201);
    expect((await res.json()).currency).toBe('eur');
  });

  test('rejects an unsupported currency', async ({ api }) => {
    const res = await api.createIntent({ amount: 1000, currency: 'xyz' });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: 'currency_unsupported', param: 'currency' });
  });

  test('rejects a missing currency', async ({ api }) => {
    const res = await api.createIntent({ amount: 1000 });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: 'parameter_missing', param: 'currency' });
  });

  test('rejects a non-string currency', async ({ api }) => {
    const res = await api.createIntent({ amount: 1000, currency: 840 });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('currency_invalid');
  });

  test('treats JPY as a zero-decimal currency: amount is in whole yen', async ({ api }) => {
    const res = await api.createIntent({ amount: 5000, currency: 'jpy' });
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ amount: 5000, currency: 'jpy' });
  });
});
