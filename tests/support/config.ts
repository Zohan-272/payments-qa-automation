/** Must match the mock server defaults (server/src/config.ts). Override via env when needed. */
export const API_KEY = process.env.MOCK_API_KEY ?? 'sk_test_demo_key';
export const WEBHOOK_SECRET = process.env.MOCK_WEBHOOK_SECRET ?? 'whsec_demo_secret';
export const WEBHOOK_TOLERANCE_SECONDS = 300;
