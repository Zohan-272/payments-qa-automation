import { expect, test as base } from '@playwright/test';
import { PaymentsApi } from './api-client';
import { card, CARDS } from './cards';

type Fixtures = {
  api: PaymentsApi;
  /** Creates an intent with a unique order_id in metadata and returns it. */
  newIntent: (overrides?: Record<string, unknown>) => Promise<{ id: string; orderId: string; body: any }>;
  /** Creates and successfully pays an intent. */
  paidIntent: (overrides?: Record<string, unknown>) => Promise<{ id: string; orderId: string; body: any }>;
};

export const uniqueId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    await use(new PaymentsApi(request));
  },
  newIntent: async ({ api }, use) => {
    await use(async (overrides = {}) => {
      const orderId = uniqueId('order');
      const res = await api.createIntent({ amount: 2000, currency: 'usd', metadata: { order_id: orderId }, ...overrides });
      expect(res.status(), await res.text()).toBe(201);
      const body = await res.json();
      return { id: body.id, orderId, body };
    });
  },
  paidIntent: async ({ api, newIntent }, use) => {
    await use(async (overrides = {}) => {
      const intent = await newIntent(overrides);
      const res = await api.confirm(intent.id, card(CARDS.visaSuccess));
      expect(res.status(), await res.text()).toBe(200);
      return { ...intent, body: await res.json() };
    });
  },
});

export { expect };
