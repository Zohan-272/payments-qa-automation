import express, { NextFunction, Request, Response, Router } from 'express';
import { API_KEY } from './config';
import { ApiError } from './errors';
import * as service from './service';
import { deliver, events } from './webhooks';

/** Idempotency-Key support for POST requests: replay the stored response, reject mismatched reuse. */
const idempotencyStore = new Map<string, { fingerprint: string; status: number; body: unknown }>();

function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.header('idempotency-key');
  if (req.method !== 'POST' || !key) return next();
  const fingerprint = `${req.path}|${JSON.stringify(req.body ?? {})}`;
  const stored = idempotencyStore.get(key);
  if (stored) {
    if (stored.fingerprint !== fingerprint) {
      return res.status(400).json({
        error: {
          type: 'idempotency_error',
          code: 'idempotency_key_in_use',
          message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.',
        },
      });
    }
    res.setHeader('Idempotent-Replayed', 'true');
    return res.status(stored.status).json(stored.body);
  }
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode < 500) idempotencyStore.set(key, { fingerprint, status: res.statusCode, body });
    return originalJson(body);
  };
  next();
}

function auth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  if (header !== `Bearer ${API_KEY}`) {
    return res.status(401).json({
      error: { type: 'authentication_error', code: 'invalid_api_key', message: 'Invalid or missing API key.' },
    });
  }
  next();
}

const handler =
  (fn: (req: Request) => unknown, status = 200) =>
  (req: Request, res: Response) => {
    try {
      res.status(status).json(fn(req));
    } catch (err) {
      if (err instanceof ApiError) return res.status(err.status).json({ error: err.body });
      console.error(err);
      res.status(500).json({ error: { type: 'api_error', code: 'internal_error', message: 'Internal error.' } });
    }
  };

export function providerRouter(): Router {
  const router = Router();
  router.use(express.json());
  router.use(auth);
  router.use(idempotency);

  router.post('/payment_intents', handler((req) => service.createIntent(req.body), 201));
  router.get('/payment_intents/:id', handler((req) => service.getIntent(String(req.params.id))));
  router.post('/payment_intents/:id/confirm', handler((req) => service.confirmIntent(String(req.params.id), req.body?.card)));
  router.post(
    '/payment_intents/:id/3ds_challenge',
    handler((req) => service.completeChallenge(String(req.params.id), req.body?.result)),
  );
  router.post('/refunds', handler((req) => service.createRefund(req.body), 201));
  router.get('/refunds/:id', handler((req) => service.getRefund(String(req.params.id))));

  router.get(
    '/events',
    handler((req) => {
      const { type, payment_intent } = req.query;
      const data = [...events.values()].filter((e) => {
        if (type && e.type !== type) return false;
        if (payment_intent) {
          const o = e.data.object;
          return o.id === payment_intent || o.payment_intent === payment_intent;
        }
        return true;
      });
      return { object: 'list', data };
    }),
  );
  router.post('/events/:id/resend', async (req, res) => {
    const event = events.get(String(req.params.id));
    if (!event) {
      return res.status(404).json({ error: { type: 'invalid_request_error', code: 'resource_missing', message: 'No such event.' } });
    }
    await deliver(event);
    res.json(event);
  });

  return router;
}
