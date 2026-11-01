export const PORT = Number(process.env.MOCK_PORT ?? 4010);
/** Demo credentials. These are fake values that only exist for this mock server. */
export const API_KEY = process.env.MOCK_API_KEY ?? 'sk_test_demo_key';
export const WEBHOOK_SECRET = process.env.MOCK_WEBHOOK_SECRET ?? 'whsec_demo_secret';
export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const WEBHOOK_URL =
  process.env.MOCK_WEBHOOK_URL ?? `http://127.0.0.1:${PORT}/merchant/webhooks`;

export const MIN_AMOUNT = 50;
export const MAX_AMOUNT = 99_999_999;
/** Supported currencies. All amounts are integers in the smallest currency unit (JPY has no minor unit). */
export const SUPPORTED_CURRENCIES = ['usd', 'eur', 'gbp', 'jpy'] as const;
