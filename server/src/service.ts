import { MAX_AMOUNT, MIN_AMOUNT, SUPPORTED_CURRENCIES } from './config';
import { CARD_OUTCOMES, CardOutcome, luhnValid } from './cards';
import { ApiError, invalid } from './errors';
import { newId } from './store';
import { emitEvent } from './webhooks';

export type IntentStatus = 'requires_payment_method' | 'requires_action' | 'succeeded';

export interface PaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  currency: string;
  status: IntentStatus;
  description: string | null;
  metadata: Record<string, string>;
  amount_received: number;
  amount_refunded: number;
  refunded: boolean;
  card_last4: string | null;
  card_brand: string | null;
  last_payment_error: { code: string; decline_code?: string; message: string } | null;
  next_action: { type: 'redirect_to_url'; redirect_to_url: { url: string } } | null;
  created: number;
}

export interface Refund {
  id: string;
  object: 'refund';
  payment_intent: string;
  amount: number;
  currency: string;
  status: 'succeeded';
  reason: string | null;
  created: number;
}

export interface CardInput {
  number?: unknown;
  exp_month?: unknown;
  exp_year?: unknown;
  cvc?: unknown;
}

const intents = new Map<string, PaymentIntent>();
const refunds = new Map<string, Refund>();
/** Internal: what the issuer will do once the 3DS challenge is completed. */
const pendingChallenges = new Map<string, CardOutcome & { kind: 'three_ds' }>();

const now = () => Math.floor(Date.now() / 1000);

export function validateAmountAndCurrency(amount: unknown, currency: unknown) {
  if (amount === undefined || amount === null || amount === '') {
    throw invalid('parameter_missing', 'Missing required param: amount.', 'amount');
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw invalid('amount_invalid', 'Invalid integer: amount must be a whole number in the smallest currency unit.', 'amount');
  }
  if (currency === undefined || currency === null || currency === '') {
    throw invalid('parameter_missing', 'Missing required param: currency.', 'currency');
  }
  if (typeof currency !== 'string') {
    throw invalid('currency_invalid', 'Invalid currency: must be a string.', 'currency');
  }
  const normalized = currency.toLowerCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)) {
    throw invalid('currency_unsupported', `Unsupported currency: ${currency}.`, 'currency');
  }
  if (amount <= 0) throw invalid('amount_invalid', 'Invalid amount: must be a positive integer.', 'amount');
  if (amount < MIN_AMOUNT) {
    throw invalid('amount_too_small', `Amount must be at least ${MIN_AMOUNT} in the smallest currency unit.`, 'amount');
  }
  if (amount > MAX_AMOUNT) {
    throw invalid('amount_too_large', `Amount must be no more than ${MAX_AMOUNT}.`, 'amount');
  }
  return { amount, currency: normalized };
}

export function createIntent(input: any): PaymentIntent {
  const { amount, currency } = validateAmountAndCurrency(input?.amount, input?.currency);
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(input?.metadata ?? {})) metadata[k] = String(v);
  const intent: PaymentIntent = {
    id: newId('pi'),
    object: 'payment_intent',
    amount,
    currency,
    status: 'requires_payment_method',
    description: typeof input?.description === 'string' ? input.description : null,
    metadata,
    amount_received: 0,
    amount_refunded: 0,
    refunded: false,
    card_last4: null,
    card_brand: null,
    last_payment_error: null,
    next_action: null,
    created: now(),
  };
  intents.set(intent.id, intent);
  emitEvent('payment_intent.created', intent);
  return intent;
}

export function getIntent(id: string): PaymentIntent {
  const intent = intents.get(id);
  if (!intent) {
    throw new ApiError(404, { type: 'invalid_request_error', code: 'resource_missing', message: `No such payment_intent: ${id}`, param: 'id' });
  }
  return intent;
}

function cardError(intent: PaymentIntent, code: string, message: string, declineCode?: string): ApiError {
  intent.last_payment_error = { code, decline_code: declineCode, message };
  intent.status = 'requires_payment_method';
  emitEvent('payment_intent.payment_failed', intent);
  return new ApiError(402, {
    type: 'card_error',
    code,
    message,
    decline_code: declineCode,
    payment_intent: structuredClone(intent),
  });
}

export function confirmIntent(id: string, card: CardInput | undefined): PaymentIntent {
  const intent = getIntent(id);
  if (intent.status !== 'requires_payment_method') {
    throw new ApiError(409, {
      type: 'invalid_request_error',
      code: 'payment_intent_unexpected_state',
      message: `This PaymentIntent's status is ${intent.status}, so it cannot be confirmed.`,
    });
  }
  if (!card || typeof card !== 'object') throw invalid('parameter_missing', 'Missing required param: card.', 'card');

  const number = String(card.number ?? '').replace(/[\s-]/g, '');
  if (!luhnValid(number)) {
    throw invalid('incorrect_number', 'Your card number is incorrect.', 'card[number]');
  }
  const expMonth = Number(card.exp_month);
  const expYear = Number(card.exp_year);
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12 || !Number.isInteger(expYear)) {
    throw invalid('invalid_expiry', "Your card's expiration date is invalid.", 'card[exp_month]');
  }
  const today = new Date();
  const expired = expYear < today.getUTCFullYear() || (expYear === today.getUTCFullYear() && expMonth < today.getUTCMonth() + 1);
  if (expired) throw cardError(intent, 'card_declined', 'Your card has expired.', 'expired_card');
  if (!/^\d{3,4}$/.test(String(card.cvc ?? ''))) {
    throw invalid('invalid_cvc', "Your card's security code is invalid.", 'card[cvc]');
  }

  intent.card_last4 = number.slice(-4);
  const outcome: CardOutcome = CARD_OUTCOMES[number] ?? { kind: 'succeed', brand: 'unknown' };
  if (outcome.kind === 'decline') {
    throw cardError(intent, 'card_declined', outcome.message, outcome.declineCode);
  }
  intent.card_brand = outcome.brand;
  intent.last_payment_error = null;
  if (outcome.kind === 'three_ds') {
    intent.status = 'requires_action';
    intent.next_action = { type: 'redirect_to_url', redirect_to_url: { url: `/3ds/${intent.id}` } };
    pendingChallenges.set(intent.id, outcome);
    return intent;
  }
  succeed(intent);
  return intent;
}

function succeed(intent: PaymentIntent) {
  intent.status = 'succeeded';
  intent.amount_received = intent.amount;
  intent.next_action = null;
  emitEvent('payment_intent.succeeded', intent);
}

/** Simulates the cardholder finishing (or failing) the issuer's 3-D Secure challenge. */
export function completeChallenge(id: string, result: unknown): PaymentIntent {
  const intent = getIntent(id);
  const pending = pendingChallenges.get(id);
  if (intent.status !== 'requires_action' || !pending) {
    throw new ApiError(409, {
      type: 'invalid_request_error',
      code: 'payment_intent_unexpected_state',
      message: `This PaymentIntent's status is ${intent.status}, so it has no 3DS challenge to complete.`,
    });
  }
  if (result !== 'success' && result !== 'failure') {
    throw invalid('parameter_invalid_enum', "result must be 'success' or 'failure'.", 'result');
  }
  pendingChallenges.delete(id);
  intent.next_action = null;
  if (result === 'failure') {
    intent.status = 'requires_payment_method';
    intent.last_payment_error = {
      code: 'payment_intent_authentication_failure',
      message: 'The provided payment method failed authentication.',
    };
    emitEvent('payment_intent.payment_failed', intent);
    return intent;
  }
  if (pending.thenDecline) {
    intent.status = 'requires_payment_method';
    intent.last_payment_error = { code: 'card_declined', decline_code: 'generic_decline', message: 'Your card was declined.' };
    emitEvent('payment_intent.payment_failed', intent);
    return intent;
  }
  succeed(intent);
  return intent;
}

export function createRefund(input: any): Refund {
  if (!input?.payment_intent) throw invalid('parameter_missing', 'Missing required param: payment_intent.', 'payment_intent');
  const intent = getIntent(String(input.payment_intent));
  if (intent.status !== 'succeeded') {
    throw invalid('payment_intent_not_refundable', 'This PaymentIntent has not been paid, so it cannot be refunded.', 'payment_intent');
  }
  const remaining = intent.amount_received - intent.amount_refunded;
  let amount = remaining;
  if (input.amount !== undefined) {
    if (typeof input.amount !== 'number' || !Number.isInteger(input.amount) || input.amount <= 0) {
      throw invalid('amount_invalid', 'Invalid amount: must be a positive integer.', 'amount');
    }
    amount = input.amount;
  }
  if (remaining === 0) throw invalid('charge_already_refunded', 'This payment has already been fully refunded.', 'payment_intent');
  if (amount > remaining) {
    throw invalid('amount_too_large', `Refund amount (${amount}) is greater than the unrefunded amount on the payment (${remaining}).`, 'amount');
  }
  const refund: Refund = {
    id: newId('re'),
    object: 'refund',
    payment_intent: intent.id,
    amount,
    currency: intent.currency,
    status: 'succeeded',
    reason: typeof input.reason === 'string' ? input.reason : null,
    created: now(),
  };
  refunds.set(refund.id, refund);
  intent.amount_refunded += amount;
  intent.refunded = intent.amount_refunded === intent.amount_received;
  emitEvent('charge.refunded', {
    id: refund.id,
    object: 'charge',
    payment_intent: intent.id,
    amount: intent.amount_received,
    amount_refunded: intent.amount_refunded,
    refunded: intent.refunded,
    currency: intent.currency,
    metadata: intent.metadata,
  });
  return refund;
}

export function getRefund(id: string): Refund {
  const refund = refunds.get(id);
  if (!refund) {
    throw new ApiError(404, { type: 'invalid_request_error', code: 'resource_missing', message: `No such refund: ${id}`, param: 'id' });
  }
  return refund;
}
