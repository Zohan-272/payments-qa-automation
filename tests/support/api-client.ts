import { APIRequestContext, APIResponse } from '@playwright/test';
import { API_KEY } from './config';

interface CallOptions {
  idempotencyKey?: string;
  apiKey?: string | null;
}

/** Thin typed wrapper around the mock provider API. Keeps specs readable. */
export class PaymentsApi {
  constructor(private request: APIRequestContext) {}

  private headers(opts: CallOptions = {}) {
    const headers: Record<string, string> = {};
    const key = opts.apiKey === undefined ? API_KEY : opts.apiKey;
    if (key) headers.authorization = `Bearer ${key}`;
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    return headers;
  }

  createIntent(data: Record<string, unknown>, opts?: CallOptions): Promise<APIResponse> {
    return this.request.post('/v1/payment_intents', { data, headers: this.headers(opts) });
  }
  getIntent(id: string, opts?: CallOptions) {
    return this.request.get(`/v1/payment_intents/${id}`, { headers: this.headers(opts) });
  }
  confirm(id: string, card: unknown, opts?: CallOptions) {
    return this.request.post(`/v1/payment_intents/${id}/confirm`, { data: { card }, headers: this.headers(opts) });
  }
  challenge(id: string, result: string, opts?: CallOptions) {
    return this.request.post(`/v1/payment_intents/${id}/3ds_challenge`, { data: { result }, headers: this.headers(opts) });
  }
  refund(data: Record<string, unknown>, opts?: CallOptions) {
    return this.request.post('/v1/refunds', { data, headers: this.headers(opts) });
  }
  getRefund(id: string) {
    return this.request.get(`/v1/refunds/${id}`, { headers: this.headers() });
  }
  events(query: Record<string, string>) {
    return this.request.get('/v1/events', { params: query, headers: this.headers() });
  }
  resendEvent(id: string) {
    return this.request.post(`/v1/events/${id}/resend`, { headers: this.headers() });
  }
  order(id: string) {
    return this.request.get(`/merchant/orders/${id}`);
  }
  postWebhook(payload: string, signatureHeader?: string) {
    return this.request.post('/merchant/webhooks', {
      data: Buffer.from(payload, 'utf8'), // raw bytes: the signature covers the exact body
      headers: { 'content-type': 'application/json', ...(signatureHeader ? { 'mock-signature': signatureHeader } : {}) },
    });
  }
}
