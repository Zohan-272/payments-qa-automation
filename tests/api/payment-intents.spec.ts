import { test, expect } from '../support/fixtures';

test.describe('Payment intent creation', () => {
  test('creates an intent in requires_payment_method state @smoke', async ({ api }) => {
    const res = await api.createIntent({ amount: 2500, currency: 'usd', description: 'Demo order', metadata: { order_id: 'o-1' } });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      object: 'payment_intent',
      amount: 2500,
      currency: 'usd',
      status: 'requires_payment_method',
      amount_received: 0,
      amount_refunded: 0,
      description: 'Demo order',
      metadata: { order_id: 'o-1' },
      last_payment_error: null,
      next_action: null,
    });
    expect(body.id).toMatch(/^pi_[0-9a-f]+$/);
  });

  test('retrieves a created intent by id', async ({ api, newIntent }) => {
    const { id } = await newIntent({ amount: 4200, currency: 'eur' });
    const res = await api.getIntent(id);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ id, amount: 4200, currency: 'eur' });
  });

  test('returns 404 resource_missing for an unknown intent', async ({ api }) => {
    const res = await api.getIntent('pi_does_not_exist');
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toMatchObject({ code: 'resource_missing', type: 'invalid_request_error' });
  });

  test('rejects requests without a valid API key', async ({ api }) => {
    for (const apiKey of [null, 'sk_test_wrong']) {
      const res = await api.createIntent({ amount: 2000, currency: 'usd' }, { apiKey });
      expect(res.status()).toBe(401);
      expect((await res.json()).error.type).toBe('authentication_error');
    }
  });

  test('rejects a malformed JSON body with 400', async ({ request }) => {
    const res = await request.post('/v1/payment_intents', {
      data: '{"amount": 2000,',
      headers: { authorization: 'Bearer sk_test_demo_key', 'content-type': 'application/json' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_json');
  });
});
