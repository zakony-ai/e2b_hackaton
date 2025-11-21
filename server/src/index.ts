import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.get('/healthcheck', (c) => {
  return c.json({ status: 'ok', message: 'Server is up and running' });
});

const port = parseInt(process.env.PORT || '3001');

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
