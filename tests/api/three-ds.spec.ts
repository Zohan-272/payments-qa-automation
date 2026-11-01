import { CARDS, card } from '../support/cards';
import { test, expect } from '../support/fixtures';

test.describe('3-D Secure flow', () => {
  test('3DS card moves the intent to requires_action with a redirect URL @smoke', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.confirm(id, card(CARDS.threeDsRequired));
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 'requires_action',
      amount_received: 0,
      next_action: { type: 'redirect_to_url', redirect_to_url: { url: `/3ds/${id}` } },
    });
  });

  test('successful authentication completes the payment', async ({ api, newIntent }) => {
    const { id } = await newIntent({ amount: 7500 });
    await api.confirm(id, card(CARDS.threeDsRequired));
    const res = await api.challenge(id, 'success');
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'succeeded', amount_received: 7500, next_action: null });
  });

  test('failed authentication returns the intent to requires_payment_method', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    await api.confirm(id, card(CARDS.threeDsRequired));
    const res = await api.challenge(id, 'failure');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'requires_payment_method', amount_received: 0, next_action: null });
    expect(body.last_payment_error.code).toBe('payment_intent_authentication_failure');
  });

  test('card that authenticates but is then declined ends in requires_payment_method', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    await api.confirm(id, card(CARDS.threeDsThenDecline));
    const res = await api.challenge(id, 'success');
    const body = await res.json();
    expect(body).toMatchObject({ status: 'requires_payment_method', amount_received: 0 });
    expect(body.last_payment_error).toMatchObject({ code: 'card_declined', decline_code: 'generic_decline' });
  });

  test('a challenge cannot be completed twice', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    await api.confirm(id, card(CARDS.threeDsRequired));
    expect((await api.challenge(id, 'success')).status()).toBe(200);
    const second = await api.challenge(id, 'success');
    expect(second.status()).toBe(409);
    expect((await second.json()).error.code).toBe('payment_intent_unexpected_state');
  });

  test('a challenge cannot be completed on an intent that does not require action', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.challenge(id, 'success');
    expect(res.status()).toBe(409);
  });

  test('rejects an unknown challenge result', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    await api.confirm(id, card(CARDS.threeDsRequired));
    const res = await api.challenge(id, 'maybe');
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('parameter_invalid_enum');
  });

  test('a refund is refused while the payment is still awaiting authentication', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    await api.confirm(id, card(CARDS.threeDsRequired));
    const res = await api.refund({ payment_intent: id });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('payment_intent_not_refundable');
  });
});
