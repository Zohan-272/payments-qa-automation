/**
 * Stripe-style test card numbers and the outcome this mock gives each one.
 * The numbers follow the public Stripe test-card convention.
 */
export type CardOutcome =
  | { kind: 'succeed'; brand: string }
  | { kind: 'decline'; declineCode: string; message: string }
  | { kind: 'three_ds'; thenDecline?: boolean; brand: string };

export const CARD_OUTCOMES: Record<string, CardOutcome> = {
  '4242424242424242': { kind: 'succeed', brand: 'visa' },
  '5555555555554444': { kind: 'succeed', brand: 'mastercard' },
  '4000000000000002': { kind: 'decline', declineCode: 'generic_decline', message: 'Your card was declined.' },
  '4000000000009995': {
    kind: 'decline',
    declineCode: 'insufficient_funds',
    message: 'Your card has insufficient funds.',
  },
  '4000000000009987': { kind: 'decline', declineCode: 'lost_card', message: 'Your card was declined.' },
  '4000000000000069': { kind: 'decline', declineCode: 'expired_card', message: 'Your card has expired.' },
  '4000000000000127': {
    kind: 'decline',
    declineCode: 'incorrect_cvc',
    message: "Your card's security code is incorrect.",
  },
  '4000002500003155': { kind: 'three_ds', brand: 'visa' },
  '4000008400001629': { kind: 'three_ds', thenDecline: true, brand: 'visa' },
};

export function luhnValid(number: string): boolean {
  if (!/^\d{12,19}$/.test(number)) return false;
  let sum = 0;
  let double = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let digit = Number(number[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}
