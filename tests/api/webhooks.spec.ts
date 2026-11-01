import { CARDS, card } from '../support/cards';
import { WEBHOOK_TOLERANCE_SECONDS } from '../support/config';
import { test, expect, uniqueId } from '../support/fixtures';
import { buildEvent, signPayload } from '../support/webhook-signature';

const intentObject = (orderId: string, extra: Record<string, unknown> = {}) => ({
  id: uniqueId('pi'),
  amount: 2000,
  currency: 'usd',
  metadata: { order_id: orderId },
  ...extra,
});

test.describe('Webhook signature verification (merchant endpoint)', () => {
  test('accepts a correctly signed event @smoke', async ({ api }) => {
    const orderId = uniqueId('order');
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId)));
    const res = await api.postWebhook(payload, signPayload(payload));
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ received: true });
    expect(await (await api.order(orderId)).json()).toMatchObject({ id: orderId, status: 'paid' });
  });

  test('signature is computed over the raw bytes (pretty-printed JSON also verifies)', async ({ api }) => {
    const orderId = uniqueId('order');
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId)), null, 2);
    const res = await api.postWebhook(payload, signPayload(payload));
    expect(res.status()).toBe(200);
  });

  test('rejects a request with no signature header', async ({ api }) => {
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(uniqueId('order'))));
    const res = await api.postWebhook(payload);
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_signature' });
  });

  for (const [name, header] of [
    ['garbage', 'not-a-signature'],
    ['missing v1', `t=${Math.floor(Date.now() / 1000)}`],
    ['non-numeric timestamp', 't=abc,v1=deadbeef'],
  ] as const) {
    test(`rejects a malformed signature header (${name})`, async ({ api }) => {
      const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(uniqueId('order'))));
      const res = await api.postWebhook(payload, header);
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe('malformed_signature');
    });
  }

  test('rejects an event signed with the wrong secret', async ({ api }) => {
    const orderId = uniqueId('order');
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId)));
    const res = await api.postWebhook(payload, signPayload(payload, { secret: 'whsec_attacker' }));
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_signature' });
    expect((await api.order(orderId)).status()).toBe(404); // no side effects
  });

  test('rejects a tampered payload (signed amount differs from the body)', async ({ api }) => {
    const orderId = uniqueId('order');
    const original = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId, { amount: 100 })));
    const tampered = original.replace('"amount":100', '"amount":999999');
    const res = await api.postWebhook(tampered, signPayload(original));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('invalid_signature');
    expect((await api.order(orderId)).status()).toBe(404);
  });

  test('rejects an old (replayed) event outside the timestamp tolerance', async ({ api }) => {
    const orderId = uniqueId('order');
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId)));
    const stale = Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 60;
    const res = await api.postWebhook(payload, signPayload(payload, { timestamp: stale }));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('timestamp_outside_tolerance');
    expect((await api.order(orderId)).status()).toBe(404);
  });

  test('rejects an event timestamped too far in the future', async ({ api }) => {
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(uniqueId('order'))));
    const future = Math.floor(Date.now() / 1000) + WEBHOOK_TOLERANCE_SECONDS + 60;
    const res = await api.postWebhook(payload, signPayload(payload, { timestamp: future }));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('timestamp_outside_tolerance');
  });

  test('accepts an event slightly inside the tolerance window', async ({ api }) => {
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(uniqueId('order'))));
    const almostStale = Math.floor(Date.now() / 1000) - (WEBHOOK_TOLERANCE_SECONDS - 30);
    const res = await api.postWebhook(payload, signPayload(payload, { timestamp: almostStale }));
    expect(res.status()).toBe(200);
  });

  test('rejects a validly signed body that is not JSON', async ({ api }) => {
    const payload = 'this is not json';
    const res = await api.postWebhook(payload, signPayload(payload));
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('invalid_payload');
  });
});

test.describe('Webhook event handling (merchant side effects)', () => {
  test('duplicate delivery of the same event id is acknowledged but not re-applied', async ({ api }) => {
    const orderId = uniqueId('order');
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId)));
    const first = await api.postWebhook(payload, signPayload(payload));
    const second = await api.postWebhook(payload, signPayload(payload));
    expect(first.status()).toBe(200);
    expect(await first.json()).not.toHaveProperty('duplicate');
    expect(second.status()).toBe(200);
    expect(await second.json()).toMatchObject({ received: true, duplicate: true });
  });

  test('unknown event types are acknowledged and ignored', async ({ api }) => {
    const payload = JSON.stringify(buildEvent('customer.created', intentObject(uniqueId('order'))));
    const res = await api.postWebhook(payload, signPayload(payload));
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, ignored: true });
  });

  test('events without an order reference are acknowledged and ignored', async ({ api }) => {
    const payload = JSON.stringify(buildEvent('payment_intent.succeeded', { id: uniqueId('pi'), amount: 1000, currency: 'usd', metadata: {} }));
    const res = await api.postWebhook(payload, signPayload(payload));
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
  });

  test('payment_failed marks the order failed, and a later success marks it paid', async ({ api }) => {
    const orderId = uniqueId('order');
    const failed = JSON.stringify(buildEvent('payment_intent.payment_failed', intentObject(orderId)));
    await api.postWebhook(failed, signPayload(failed));
    expect((await (await api.order(orderId)).json()).status).toBe('payment_failed');

    const succeeded = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId)));
    await api.postWebhook(succeeded, signPayload(succeeded));
    expect((await (await api.order(orderId)).json()).status).toBe('paid');
  });

  test('a late "succeeded" event does not undo a refund (out-of-order delivery)', async ({ api }) => {
    const orderId = uniqueId('order');
    const refunded = JSON.stringify(
      buildEvent('charge.refunded', { ...intentObject(orderId), amount: 2000, amount_refunded: 2000, refunded: true }),
    );
    await api.postWebhook(refunded, signPayload(refunded));
    const succeeded = JSON.stringify(buildEvent('payment_intent.succeeded', intentObject(orderId)));
    await api.postWebhook(succeeded, signPayload(succeeded));
    expect(await (await api.order(orderId)).json()).toMatchObject({ status: 'refunded', refunded_amount: 2000 });
  });
});

test.describe('End to end: provider sends signed webhooks to the merchant', () => {
  test('successful payment marks the order as paid @smoke', async ({ api, newIntent }) => {
    const { id, orderId } = await newIntent({ amount: 2600 });
    await api.confirm(id, card(CARDS.visaSuccess));

    await expect.poll(async () => (await (await api.order(orderId)).json()).status, { timeout: 10_000 }).toBe('paid');

    const events = await (await api.events({ type: 'payment_intent.succeeded', payment_intent: id })).json();
    expect(events.data).toHaveLength(1);
    expect(events.data[0].delivery).toMatchObject({ status: 'delivered', last_response_status: 200 });
  });

  test('declined payment marks the order as payment_failed', async ({ api, newIntent }) => {
    const { id, orderId } = await newIntent();
    await api.confirm(id, card(CARDS.insufficientFunds));
    await expect.poll(async () => (await (await api.order(orderId)).json()).status, { timeout: 10_000 }).toBe('payment_failed');
  });

  test('3DS payment becomes paid only after authentication completes', async ({ api, newIntent }) => {
    const { id, orderId } = await newIntent();
    await api.confirm(id, card(CARDS.threeDsRequired));

    // Still awaiting authentication: no "succeeded" event has been produced.
    const before = await (await api.events({ type: 'payment_intent.succeeded', payment_intent: id })).json();
    expect(before.data).toHaveLength(0);

    await api.challenge(id, 'success');
    await expect.poll(async () => (await (await api.order(orderId)).json()).status, { timeout: 10_000 }).toBe('paid');
  });

  test('partial then full refund move the order through partially_refunded to refunded', async ({ api, paidIntent }) => {
    const { id, orderId } = await paidIntent({ amount: 3000 });
    await expect.poll(async () => (await (await api.order(orderId)).json()).status, { timeout: 10_000 }).toBe('paid');

    await api.refund({ payment_intent: id, amount: 1000 });
    await expect
      .poll(async () => await (await api.order(orderId)).json(), { timeout: 10_000 })
      .toMatchObject({ status: 'partially_refunded', refunded_amount: 1000 });

    await api.refund({ payment_intent: id });
    await expect
      .poll(async () => await (await api.order(orderId)).json(), { timeout: 10_000 })
      .toMatchObject({ status: 'refunded', refunded_amount: 3000 });
  });

  test('resending an already-delivered event is safe (merchant dedupes by event id)', async ({ api, paidIntent }) => {
    const { id, orderId } = await paidIntent({ amount: 3000 });
    await api.refund({ payment_intent: id, amount: 1000 });
    await expect
      .poll(async () => (await (await api.order(orderId)).json()).refunded_amount, { timeout: 10_000 })
      .toBe(1000);

    const events = await (await api.events({ type: 'charge.refunded', payment_intent: id })).json();
    const resent = await (await api.resendEvent(events.data[0].id)).json();
    expect(resent.delivery.attempts).toBe(2);
    expect(resent.delivery.last_response_status).toBe(200);
    expect(await (await api.order(orderId)).json()).toMatchObject({ status: 'partially_refunded', refunded_amount: 1000 });
  });
});
