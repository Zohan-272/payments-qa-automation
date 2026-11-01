/** Stripe-style test cards and the behaviour the mock server gives each one. */
export const CARDS = {
  visaSuccess: '4242424242424242',
  mastercardSuccess: '5555555555554444',
  genericDecline: '4000000000000002',
  insufficientFunds: '4000000000009995',
  lostCard: '4000000000009987',
  expiredCard: '4000000000000069',
  incorrectCvc: '4000000000000127',
  threeDsRequired: '4000002500003155',
  threeDsThenDecline: '4000008400001629',
} as const;

const nextYear = new Date().getUTCFullYear() + 2;

export const card = (number: string, overrides: Record<string, unknown> = {}) => ({
  number,
  exp_month: 12,
  exp_year: nextYear,
  cvc: '123',
  ...overrides,
});
