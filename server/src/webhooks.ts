import { createHmac, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_SECRET, WEBHOOK_TOLERANCE_SECONDS, WEBHOOK_URL } from './config';
import { newId } from './store';

export const SIGNATURE_HEADER = 'mock-signature';

/** Signature scheme (same idea as Stripe): HMAC-SHA256 over `${timestamp}.${rawBody}`. */
export function computeSignature(secret: string, timestamp: number, payload: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

export function buildSignatureHeader(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, payload)}`;
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_signature' | 'malformed_signature' | 'timestamp_outside_tolerance' | 'invalid_signature' };

export function verifySignature(
  header: string | undefined,
  payload: string,
  secret = WEBHOOK_SECRET,
  now = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing_signature' };
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k.trim(), v.join('=')];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return { ok: false, reason: 'malformed_signature' };
  if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_outside_tolerance' };
  }
  const expected = Buffer.from(computeSignature(secret, timestamp, payload), 'hex');
  const received = Buffer.from(parts.v1, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return { ok: true };
}

export interface WebhookEvent {
  id: string;
  object: 'event';
  type: string;
  created: number;
  data: { object: Record<string, any> };
  delivery: { status: 'pending' | 'delivered' | 'failed'; attempts: number; last_response_status: number | null };
}

export const events = new Map<string, WebhookEvent>();

export async function deliver(event: WebhookEvent, url = WEBHOOK_URL): Promise<void> {
  const payload = JSON.stringify({ id: event.id, object: 'event', type: event.type, created: event.created, data: event.data });
  event.delivery.attempts += 1;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: buildSignatureHeader(WEBHOOK_SECRET, payload) },
      body: payload,
    });
    event.delivery.last_response_status = res.status;
    event.delivery.status = res.ok ? 'delivered' : 'failed';
  } catch {
    event.delivery.last_response_status = null;
    event.delivery.status = 'failed';
  }
}

export function emitEvent(type: string, object: Record<string, any>): WebhookEvent {
  const event: WebhookEvent = {
    id: newId('evt'),
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object: structuredClone(object) },
    delivery: { status: 'pending', attempts: 0, last_response_status: null },
  };
  events.set(event.id, event);
  // Deliver asynchronously, as a real provider would.
  setImmediate(() => void deliver(event));
  return event;
}
