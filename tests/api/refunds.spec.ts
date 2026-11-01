import { test, expect } from '../support/fixtures';

test.describe('Refunds', () => {
  test('full refund when no amount is given @smoke', async ({ api, paidIntent }) => {
    const { id } = await paidIntent({ amount: 5000 });
    const res = await api.refund({ payment_intent: id });
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ object: 'refund', payment_intent: id, amount: 5000, currency: 'usd', status: 'succeeded' });

    const intent = await (await api.getIntent(id)).json();
    expect(intent).toMatchObject({ amount_refunded: 5000, refunded: true, status: 'succeeded' });
  });

  test('partial refund leaves the remaining balance refundable', async ({ api, paidIntent }) => {
    const { id } = await paidIntent({ amount: 5000 });
    const res = await api.refund({ payment_intent: id, amount: 1500, reason: 'requested_by_customer' });
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ amount: 1500, reason: 'requested_by_customer' });

    expect(await (await api.getIntent(id)).json()).toMatchObject({ amount_refunded: 1500, refunded: false });
  });

  test('multiple partial refunds add up and the last one can exhaust the balance', async ({ api, paidIntent }) => {
    const { id } = await paidIntent({ amount: 3000 });
    for (const amount of [1000, 1000]) {
      expect((await api.refund({ payment_intent: id, amount })).status()).toBe(201);
    }
    // No amount = refund whatever is left.
    const last = await api.refund({ payment_intent: id });
    expect(last.status()).toBe(201);
    expect((await last.json()).amount).toBe(1000);
    expect(await (await api.getIntent(id)).json()).toMatchObject({ amount_refunded: 3000, refunded: true });
  });

  test('cannot refund more than the unrefunded amount', async ({ api, paidIntent }) => {
    const { id } = await paidIntent({ amount: 2000 });
    await api.refund({ payment_intent: id, amount: 1500 });
    const res = await api.refund({ payment_intent: id, amount: 501 });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: 'amount_too_large', param: 'amount' });
    expect((await (await api.getIntent(id)).json()).amount_refunded).toBe(1500);
  });

  test('a fully refunded payment cannot be refunded again', async ({ api, paidIntent }) => {
    const { id } = await paidIntent();
    await api.refund({ payment_intent: id });
    const res = await api.refund({ payment_intent: id });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('charge_already_refunded');
  });

  for (const [name, amount] of [['zero', 0], ['negative', -100], ['decimal', 10.5], ['string', '100']] as const) {
    test(`rejects a ${name} refund amount`, async ({ api, paidIntent }) => {
      const { id } = await paidIntent();
      const res = await api.refund({ payment_intent: id, amount });
      expect(res.status()).toBe(400);
      expect((await res.json()).error.code).toBe('amount_invalid');
    });
  }

  test('cannot refund an unpaid intent', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.refund({ payment_intent: id });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('payment_intent_not_refundable');
  });

  test('requires payment_intent and rejects unknown ones', async ({ api }) => {
    const missing = await api.refund({});
    expect(missing.status()).toBe(400);
    expect((await missing.json()).error).toMatchObject({ code: 'parameter_missing', param: 'payment_intent' });

    const unknown = await api.refund({ payment_intent: 'pi_nope' });
    expect(unknown.status()).toBe(404);
  });

  test('a refund can be retrieved by id', async ({ api, paidIntent }) => {
    const { id } = await paidIntent();
    const created = await (await api.refund({ payment_intent: id, amount: 700 })).json();
    const res = await api.getRefund(created.id);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, amount: 700, payment_intent: id });
    expect((await api.getRefund('re_nope')).status()).toBe(404);
  });
});
