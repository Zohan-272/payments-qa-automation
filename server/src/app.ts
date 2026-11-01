import express, { NextFunction, Request, Response } from 'express';
import { merchantRouter } from './merchant';
import { checkoutPage, resultPage, threeDsPage } from './pages';
import { providerRouter } from './provider';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/v1', providerRouter());
  app.use('/merchant', merchantRouter());

  app.get('/checkout', (_req, res) => res.type('html').send(checkoutPage()));
  app.get('/checkout/result', (_req, res) => res.type('html').send(resultPage()));
  app.get('/3ds/:id', (req, res) => res.type('html').send(threeDsPage(String(req.params.id))));

  // JSON error handler (e.g. malformed JSON bodies).
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { type: 'invalid_request_error', code: 'invalid_json', message: 'Request body is not valid JSON.' } });
    }
    console.error(err);
    res.status(500).json({ error: { type: 'api_error', code: 'internal_error', message: 'Internal error.' } });
  });
  return app;
}
