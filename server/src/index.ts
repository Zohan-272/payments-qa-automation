import { PORT } from './config';
import { createApp } from './app';

createApp().listen(PORT, '127.0.0.1', () => {
  console.log(`Mock payments server listening on http://127.0.0.1:${PORT}`);
});
