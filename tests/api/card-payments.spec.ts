import { CARDS, card } from '../support/cards';
import { test, expect } from '../support/fixtures';

test.describe('Card payments: success', () => {
  for (const [name, number, brand] of [
    ['Visa', CARDS.visaSuccess, 'visa'],
    ['Mastercard', CARDS.mastercardSuccess, 'mastercard'],
  ] as const) {
    test(`${name} test card succeeds @smoke`, async ({ api, newIntent }) => {
      const { id } = await newIntent({ amount: 3300 });
      const res = await api.confirm(id, card(number));
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({
        id,
        status: 'succeeded',
        amount_received: 3300,
        card_brand: brand,
        card_last4: number.slice(-4),
        last_payment_error: null,
      });
    });
  }

  test('card number may contain spaces', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.confirm(id, card('4242 4242 4242 4242'));
    expect(res.status()).toBe(200);
  });

  test('a succeeded intent cannot be confirmed again', async ({ api, paidIntent }) => {
    const { id } = await paidIntent();
    const res = await api.confirm(id, card(CARDS.visaSuccess));
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe('payment_intent_unexpected_state');
  });
});

test.describe('Card payments: declines', () => {
  const declines: Array<[string, string, string]> = [
    ['generic decline', CARDS.genericDecline, 'generic_decline'],
    ['insufficient funds', CARDS.insufficientFunds, 'insufficient_funds'],
    ['lost card', CARDS.lostCard, 'lost_card'],
    ['incorrect CVC', CARDS.incorrectCvc, 'incorrect_cvc'],
    ['expired card (by test number)', CARDS.expiredCard, 'expired_card'],
  ];

  for (const [name, number, declineCode] of declines) {
    test(`${name} returns 402 card_declined with decline_code ${declineCode}`, async ({ api, newIntent }) => {
      const { id } = await newIntent();
      const res = await api.confirm(id, card(number));
      expect(res.status()).toBe(402);
      const { error } = await res.json();
      expect(error).toMatchObject({ type: 'card_error', code: 'card_declined', decline_code: declineCode });
      expect(error.payment_intent).toMatchObject({ id, status: 'requires_payment_method' });

      // The intent stays payable: no money moved, and the failure is recorded.
      const intent = await (await api.getIntent(id)).json();
      expect(intent).toMatchObject({ status: 'requires_payment_method', amount_received: 0 });
      expect(intent.last_payment_error).toMatchObject({ code: 'card_declined', decline_code: declineCode });
    });
  }

  test('a declined intent can be retried with a good card', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    expect((await api.confirm(id, card(CARDS.genericDecline))).status()).toBe(402);
    const retry = await api.confirm(id, card(CARDS.visaSuccess));
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toMatchObject({ status: 'succeeded', last_payment_error: null });
  });
});

test.describe('Card input validation', () => {
  test('rejects a card number that fails the Luhn check', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.confirm(id, card('4242424242424241'));
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('incorrect_number');
  });

  test('rejects a card with an expiry date in the past', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.confirm(id, card(CARDS.visaSuccess, { exp_year: 2020 }));
    expect(res.status()).toBe(402);
    expect((await res.json()).error).toMatchObject({ code: 'card_declined', decline_code: 'expired_card' });
  });

  test('rejects an invalid expiry month', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.confirm(id, card(CARDS.visaSuccess, { exp_month: 13 }));
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_expiry');
  });

  test('rejects a malformed CVC', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.confirm(id, card(CARDS.visaSuccess, { cvc: '12' }));
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_cvc');
  });

  test('requires a card object', async ({ api, newIntent }) => {
    const { id } = await newIntent();
    const res = await api.confirm(id, undefined);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatchObject({ code: 'parameter_missing', param: 'card' });
  });
});
