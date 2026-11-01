import express, { Request, Response, Router } from 'express';
import { ApiError } from './errors';
import * as service from './service';
import { SIGNATURE_HEADER, verifySignature } from './webhooks';

/**
 * The "merchant" side of the demo: a tiny shop that receives webhooks from the payment provider
 * and offers a checkout page that tests drive through the browser.
 */
interface Order {
  id: string;
  status: 'pending' | 'paid' | 'payment_failed' | 'partially_refunded' | 'refunded';
  amount: number;
  currency: string;
  refunded_amount: number;
  payment_intent: string;
}

const orders = new Map<string, Order>();
const processedEvents = new Set<string>();

function applyEvent(event: any): { ignored?: boolean } {
  const object = event.data?.object ?? {};
  const orderId = object.metadata?.order_id;
  if (!orderId) return { ignored: true };
  let order = orders.get(orderId);
  if (!order) {
    order = {
      id: orderId,
      status: 'pending',
      amount: object.amount,
      currency: object.currency,
      refunded_amount: 0,
      payment_intent: object.payment_intent ?? object.id,
    };
    orders.set(orderId, order);
  }
  switch (event.type) {
    case 'payment_intent.succeeded':
      if (order.status === 'pending' || order.status === 'payment_failed') order.status = 'paid';
      return {};
    case 'payment_intent.payment_failed':
      if (order.status === 'pending') order.status = 'payment_failed';
      return {};
    case 'charge.refunded':
      order.refunded_amount = object.amount_refunded;
      order.status = object.refunded ? 'refunded' : 'partially_refunded';
      return {};
    default:
      return { ignored: true };
  }
}

export function merchantRouter(): Router {
  const router = Router();

  // The webhook route needs the RAW body: the signature is computed over the exact bytes received.
  router.post('/webhooks', express.raw({ type: '*/*', limit: '1mb' }), (req: Request, res: Response) => {
    const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const check = verifySignature(req.header(SIGNATURE_HEADER), payload);
    if (!check.ok) return res.status(400).json({ error: check.reason });

    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      return res.status(400).json({ error: 'invalid_payload' });
    }
    if (!event?.id || !event?.type) return res.status(400).json({ error: 'invalid_payload' });

    if (processedEvents.has(event.id)) return res.json({ received: true, duplicate: true });
    const result = applyEvent(event);
    processedEvents.add(event.id);
    res.json({ received: true, ...result });
  });

  router.use(express.json());

  router.get('/orders/:id', (req, res) => {
    const order = orders.get(String(req.params.id));
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    res.json(order);
  });

  /** Server-side checkout used by the checkout page. */
  router.post('/api/checkout', (req, res) => {
    try {
      const { order_id, amount, currency, card } = req.body ?? {};
      const intent = service.createIntent({ amount, currency, metadata: { order_id } });
      orders.set(order_id, {
        id: order_id,
        status: 'pending',
        amount: intent.amount,
        currency: intent.currency,
        refunded_amount: 0,
        payment_intent: intent.id,
      });
      try {
        res.json(service.confirmIntent(intent.id, card));
      } catch (err) {
        if (err instanceof ApiError && err.status === 402) {
          return res.status(402).json({ error: err.body });
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof ApiError) return res.status(err.status).json({ error: err.body });
      res.status(500).json({ error: { message: 'Internal error' } });
    }
  });

  router.get('/api/intents/:id', (req, res) => {
    try {
      res.json(service.getIntent(String(req.params.id)));
    } catch (err) {
      if (err instanceof ApiError) return res.status(err.status).json({ error: err.body });
      res.status(500).json({ error: { message: 'Internal error' } });
    }
  });

  /** Called by the 3DS simulator page. */
  router.post('/api/3ds/:id', (req, res) => {
    try {
      res.json(service.completeChallenge(String(req.params.id), req.body?.result));
    } catch (err) {
      if (err instanceof ApiError) return res.status(err.status).json({ error: err.body });
      res.status(500).json({ error: { message: 'Internal error' } });
    }
  });

  return router;
}
