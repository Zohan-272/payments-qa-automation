import { CARDS, card } from '../support/cards';
import { test, expect, uniqueId } from '../support/fixtures';

test.describe('Idempotency keys', () => {
  test('repeating a create request with the same key returns the same intent @smoke', async ({ api }) => {
    const key = uniqueId('idem');
    const body = { amount: 1234, currency: 'usd' };
    const first = await api.createIntent(body, { idempotencyKey: key });
    const second = await api.createIntent(body, { idempotencyKey: key });

    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    expect(first.headers()['idempotent-replayed']).toBeUndefined();
    expect(second.headers()['idempotent-replayed']).toBe('true');
    expect((await second.json()).id).toBe((await first.json()).id);
  });

  test('requests without a key create distinct intents', async ({ api }) => {
    const body = { amount: 1234, currency: 'usd' };
    const a = await (await api.createIntent(body)).json();
    const b = await (await api.createIntent(body)).json();
    expect(a.id).not.toBe(b.id);
  });

  test('different keys create distinct intents', async ({ api }) => {
    const body = { amount: 1234, currency: 'usd' };
    const a = await (await api.createIntent(body, { idempotencyKey: uniqueId('a') })).json();
    const b = await (await api.createIntent(body, { idempotencyKey: uniqueId('b') })).json();
    expect(a.id).not.toBe(b.id);
  });

  test('reusing a key with different parameters is rejected', async ({ api }) => {
    const key = uniqueId('idem');
    expect((await api.createIntent({ amount: 1000, currency: 'usd' }, { idempotencyKey: key })).status()).toBe(201);
    const res = await api.createIntent({ amount: 2000, currency: 'usd' }, { idempotencyKey: key });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatchObject({ type: 'idempotency_error', code: 'idempotency_key_in_use' });
  });

  test('a refund retried with the same key is applied only once', async ({ api, paidIntent }) => {
    const { id } = await paidIntent({ amount: 4000 });
    const key = uniqueId('refund');
    const first = await api.refund({ payment_intent: id, amount: 1000 }, { idempotencyKey: key });
    const second = await api.refund({ payment_intent: id, amount: 1000 }, { idempotencyKey: key });
    expect(second.headers()['idempotent-replayed']).toBe('true');
    expect((await second.json()).id).toBe((await first.json()).id);
    expect((await (await api.getIntent(id)).json()).amount_refunded).toBe(1000);
  });

  test('a refund retried WITHOUT a key is applied twice (documents why keys matter)', async ({ api, paidIntent }) => {
    const { id } = await paidIntent({ amount: 4000 });
    await api.refund({ payment_intent: id, amount: 1000 });
    await api.refund({ payment_intent: id, amount: 1000 });
    expect((await (await api.getIntent(id)).json()).amount_refunded).toBe(2000);
  });

  test('a failed (declined) confirm replays the same error for the same key', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const key = uniqueId('confirm');
    const first = await api.confirm(id, card(CARDS.genericDecline), { idempotencyKey: key });
    const second = await api.confirm(id, card(CARDS.genericDecline), { idempotencyKey: key });
    expect(first.status()).toBe(402);
    expect(second.status()).toBe(402);
    expect(second.headers()['idempotent-replayed']).toBe('true');
  });

  test('validation errors are replayed too', async ({ api }) => {
    const key = uniqueId('bad');
    const first = await api.createIntent({ amount: -1, currency: 'usd' }, { idempotencyKey: key });
    const second = await api.createIntent({ amount: -1, currency: 'usd' }, { idempotencyKey: key });
    expect(first.status()).toBe(400);
    expect(second.status()).toBe(400);
    expect(second.headers()['idempotent-replayed']).toBe('true');
  });
});
