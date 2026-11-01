import { createHmac } from 'node:crypto';
import { WEBHOOK_SECRET } from './config';

/**
 * Independent re-implementation of the signing scheme (HMAC-SHA256 over `${timestamp}.${payload}`).
 * Tests use it as an oracle instead of importing server code.
 */
export function signPayload(payload: string, opts: { secret?: string; timestamp?: number } = {}) {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function buildEvent(type: string, object: Record<string, unknown>, id = `evt_test_${Math.random().toString(36).slice(2, 12)}`) {
  return { id, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } };
}
