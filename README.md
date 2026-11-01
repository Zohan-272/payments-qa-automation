# payments-qa-automation

> **Personal demo project.** This is a portfolio project I built to practise and show how I approach test automation for payment systems. It is **not** production code, and it is **not** taken from any employer or client. The "payment provider" here is a small mock server written for this repo (Stripe-*style*, not Stripe), and it has no connection to any real payment service. No real card data or real credentials are used. Every key, secret and card number is a fake test value.

A test automation project for a mock payments API, using **Playwright + TypeScript** for both API and UI tests. The repo includes the mock payments server (Node + Express), so everything runs locally with no external services, accounts or network access.

## What it covers

| Area | What is tested |
| --- | --- |
| Payment intent creation | Create, retrieve, 404 on unknown id, API-key auth (401), malformed JSON |
| Card success / decline | Stripe-style test cards: Visa and Mastercard success, generic decline, insufficient funds, lost card, incorrect CVC, expired card; retry after decline; confirming twice (409) |
| Card input validation | Luhn check, past expiry, invalid month, malformed CVC, missing card |
| 3-D Secure | `requires_action` + redirect URL, authentication success, authentication failure, "authenticates then declined", double-completion (409), challenge on a non-3DS intent, refund blocked before authentication |
| Refunds | Full refund, partial refund, multiple partial refunds adding up, over-refund (400), refund after full refund, invalid amounts, unpaid intent, unknown ids, retrieve refund |
| Idempotency keys | Replay returns the same object (`Idempotent-Replayed: true`), distinct keys / no key create new objects, same key with different params is rejected, refund applied once, error replay |
| Webhook signatures | Valid signature, raw-bytes semantics, missing / malformed header, wrong secret, tampered body, stale and future timestamps, tolerance boundary, non-JSON body |
| Webhook event handling | Duplicate event ids deduplicated, unknown types ignored, events without order ref ignored, failed-then-paid, out-of-order delivery (late `succeeded` after `refunded`), provider to merchant end-to-end flows (paid, failed, 3DS, partial/full refund, resend) |
| Amount / currency validation | Zero, negative, decimal, string, boolean, below min, above max, boundary values, missing; supported currencies, case normalisation, unsupported / missing / non-string currency, zero-decimal JPY |
| UI (browser) | Checkout success + webhook-driven order status, decline messages, 3DS complete / fail, client-side and server-side validation, retry after decline |

98 tests in total (88 API, 10 UI). Tests tagged `@smoke` form a quick subset: `npx playwright test --grep @smoke`.

## Quick start

Requirements: Node.js 20+ (CI uses 22).

```bash
npm ci
npx playwright install chromium    # one-time: browser for the UI tests
npx playwright test                # starts the mock server automatically, runs API + UI tests
npx playwright show-report         # open the HTML report
```

Other commands:

```bash
npm run test:api       # API tests only (no browser needed)
npm run test:ui        # UI tests only
npm run typecheck      # tsc --noEmit
npm run start:mock     # run the mock server by itself on http://127.0.0.1:4010
```

`npx playwright test` starts its own mock server through Playwright's `webServer` option, so every run begins from a clean state. If you already have the server running (`npm run start:mock`), run with `REUSE_SERVER=1`. The port can be changed with `MOCK_PORT`.

## How it is organised

```
server/src/          Mock payments provider + tiny merchant app (Express)
  provider.ts        /v1 API: auth, idempotency middleware, routes
  service.ts         Payment intent / 3DS / refund logic and validation rules
  cards.ts           Stripe-style test card numbers -> outcomes, Luhn check
  webhooks.ts        Event creation, HMAC signing, delivery
  merchant.ts        /merchant: signed webhook receiver, orders, checkout API
  pages.ts           Checkout, 3DS simulator and result pages (plain HTML)
tests/
  api/               API specs (Playwright `request` fixture, no browser)
  ui/                Browser specs for the checkout page
  support/           Typed API client, fixtures, test cards, webhook signing oracle
playwright.config.ts Two projects (api, ui), HTML reporter, webServer
.github/workflows/   CI: typecheck, install, test, upload HTML report
```

## The mock API in brief

All amounts are integers in the smallest currency unit (cents; JPY is zero-decimal). Supported currencies: `usd`, `eur`, `gbp`, `jpy`. Amount range: 50 to 99,999,999. Authentication: `Authorization: Bearer sk_test_demo_key`.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/payment_intents` | Create an intent (`amount`, `currency`, optional `metadata`) |
| `GET /v1/payment_intents/:id` | Retrieve |
| `POST /v1/payment_intents/:id/confirm` | Pay with `{ card: { number, exp_month, exp_year, cvc } }` |
| `POST /v1/payment_intents/:id/3ds_challenge` | Simulate the issuer's 3DS challenge (`success` / `failure`) |
| `POST /v1/refunds`, `GET /v1/refunds/:id` | Full or partial refund |
| `GET /v1/events`, `POST /v1/events/:id/resend` | Inspect and re-deliver webhook events |
| `POST /merchant/webhooks` | Merchant webhook receiver (verifies `mock-signature`) |

Test cards (Stripe-style numbers):

| Number | Outcome |
| --- | --- |
| `4242 4242 4242 4242`, `5555 5555 5555 4444` | Success |
| `4000 0000 0000 0002` | Declined (`generic_decline`) |
| `4000 0000 0000 9995` | Declined (`insufficient_funds`) |
| `4000 0000 0000 9987` | Declined (`lost_card`) |
| `4000 0000 0000 0127` | Declined (`incorrect_cvc`) |
| `4000 0000 0000 0069` | Declined (`expired_card`) |
| `4000 0025 0000 3155` | 3DS required, then success or failure depending on the challenge |
| `4000 0084 0000 1629` | 3DS required, but declined after authentication |

Webhook signature: header `mock-signature: t=<unix timestamp>,v1=<hex HMAC-SHA256>`, where the HMAC is computed over `<timestamp>.<raw request body>` with the shared secret. Timestamps more than 300 seconds from the current time are rejected.

## Design notes

- **Independent test oracle:** the specs never import server code. `tests/support/webhook-signature.ts` re-implements the signing scheme, so a bug in the server's verification cannot hide itself.
- **Parallel-safe:** every test creates its own intents and order ids, so tests do not depend on each other or on execution order, and the suite runs fully parallel.
- **No fixed sleeps:** asynchronous webhook effects are checked with `expect.poll`, which retries until the order reaches the expected state.
- **API client wrapper:** `PaymentsApi` keeps specs focused on behaviour, and fixtures (`newIntent`, `paidIntent`) remove setup duplication.
- **Negative paths get as much attention as happy paths:** tampered and replayed webhooks, out-of-order events, double refunds, double 3DS completion and invalid amounts.

## Limitations

This is a demo and the mock is deliberately simplified. It keeps state in memory, has no persistence, no real card network logic, no webhook retry schedule, no disputes or payouts, and a deliberately small set of currencies.

## License

MIT
