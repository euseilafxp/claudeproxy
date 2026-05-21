import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from 'hono/bearer-auth';
import { chatCompletions, fetchClaudeModels } from './routes/chat.js';
import * as dotenv from 'dotenv';
import { initPlaywright, BrowserType } from './services/playwright.js';
import { networkInterfaces } from 'os';

dotenv.config();

export const app = new Hono();

app.use('*', cors());

function getNetworkAddress() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

app.use('/v1/*', async (c, next) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return await next();
  }
  return bearerAuth({ token: apiKey })(c, next);
});

app.get('/health', (c) => c.json({ status: 'ok', service: 'ClaudeProxy' }));

app.post('/v1/chat/completions', chatCompletions);

app.get('/v1/models', async (c) => {
  try {
    const models = await fetchClaudeModels();
    return c.json({
      object: 'list',
      data: models
    });
  } catch (err: any) {
    return c.json({ error: { message: err.message } }, 500);
  }
});

import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let browserType: BrowserType = 'chromium';
  const browserArg = process.argv.find(arg => arg.startsWith('--browser='));
  if (browserArg) {
    browserType = browserArg.split('=')[1] as BrowserType;
  } else if (process.env.BROWSER) {
    browserType = process.env.BROWSER as BrowserType;
  }

  const isDocker = !!process.env.DISPLAY || process.env.RUNNING_IN_DOCKER === '1';
  const headless = isDocker ? false : true;

  initPlaywright(headless, browserType).then(() => {
    console.log(`Playwright initialized (${browserType}).`);
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    
    const networkIP = getNetworkAddress();
    
    console.log('\n🚀 ClaudeProxy started!');
    console.log(`- Local:   http://localhost:${port}`);
    if (networkIP) {
      console.log(`- Network: http://${networkIP}:${port}`);
    }

    console.log('\nAvailable Routes:');
    app.routes.forEach(route => {
      console.log(`- [${route.method}] ${route.path}`);
    });
    console.log('');

    serve({
      fetch: app.fetch,
      port
    });
  }).catch((err: any) => {
    console.error('Failed to initialize playwright:', err);
    process.exit(1);
  });
}