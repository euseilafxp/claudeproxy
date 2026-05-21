import { chromium as playwrightChromium, firefox, webkit, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'edge';

let context: BrowserContext | null = null;
export let activePage: Page | null = null;
let cachedClaudeHeaders: { headers: Record<string, string>, sessionId: string } | null = null;
let lastHeadersTime = 0;
const HEADERS_TTL = 10 * 60 * 1000;
let sessionFromFile: { cookies: any[], cookieString: string } | null = null;

const SESSION_FILE = path.resolve('session.json');

function loadSessionFromFile(): { cookies: any[], cookieString: string } | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      console.log('[Playwright] Loaded session from session.json');
      return data;
    }
  } catch (err: any) {
    console.warn('[Playwright] Failed to load session.json:', err.message);
  }
  return null;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>(resolve => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const uiMutex = new Mutex();

export async function getCookies(): Promise<string> {
  if (!activePage) return '';
  const cookies = await activePage.context().cookies();
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

async function launchStealthBrowser(headless: boolean, browserType: BrowserType): Promise<BrowserContext> {
  const profilePath = path.resolve('claude_profile');

  let channel: string | undefined;
  let launchFn: any;

  switch (browserType) {
    case 'firefox':
      launchFn = firefox;
      break;
    case 'webkit':
      launchFn = webkit;
      break;
    case 'chrome':
      launchFn = playwrightChromium;
      channel = 'chrome';
      break;
    case 'edge':
      launchFn = playwrightChromium;
      channel = 'msedge';
      break;
    default:
      try {
        const { chromium: chromiumExtra } = await import('playwright-extra');
        const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
        chromiumExtra.use(StealthPlugin());
        launchFn = chromiumExtra;
      } catch {
        console.warn('[Playwright] playwright-extra not available, falling back to regular chromium');
        launchFn = playwrightChromium;
      }
      break;
  }

  const launchOptions: any = {
    headless,
    channel,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--disable-infobars',
      '--window-size=1280,720',
      '--js-flags=--max-old-space-size=256'
    ]
  };

  if (process.env.DISPLAY) {
    console.log(`[Playwright] Using DISPLAY=${process.env.DISPLAY}`);
  }

  const ctx = await launchFn.launchPersistentContext(profilePath, launchOptions);

  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    (window as any).chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      csi: () => ({ onloadTimes: {} }),
      loadTimes: () => ({ requestTime: Date.now() / 1000 }),
      runtime: { Platform: { ARCH: 'x64', NA: 'na', MAC: 'mac', WIN: 'win', LINUX: 'linux' }, RequestDetails: {} }
    };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'pt-BR'] });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ]
    });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  });

  return ctx;
}

export async function initPlaywright(headless = false, browserType: BrowserType = 'chromium') {
  if (context) {
    return;
  }

  sessionFromFile = loadSessionFromFile();

  const serverOnlyMode = process.env.SERVER_ONLY === '1' || (sessionFromFile && process.env.DISPLAY);

  if (serverOnlyMode && sessionFromFile) {
    console.log('[Playwright] Running in server-only mode (using saved session cookies)');
    cachedClaudeHeaders = {
      headers: {
        'cookie': sessionFromFile.cookieString,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'anthropic-version': '2023-06-01',
        'anthropic-sentiment-account-id': '',
        'x-anthropic-account': ''
      },
      sessionId: ''
    };
    lastHeadersTime = Date.now();
    console.log('[Playwright] Session cookies loaded. Proxy ready.');
    return;
  }

  console.log(`[Playwright] Launching ${browserType} (headless=${headless})...`);

  context = await launchStealthBrowser(headless, browserType);

  if (sessionFromFile && sessionFromFile.cookies.length > 0) {
    try {
      await context.addCookies(sessionFromFile.cookies);
      console.log('[Playwright] Injected cookies from session.json');
    } catch (err: any) {
      console.warn('[Playwright] Failed to inject cookies:', err.message);
    }
  }

  activePage = context.pages()[0] || await context.newPage();

  const hasValidSession = await checkValidSession();

  if (!hasValidSession) {
    console.warn('[Playwright] No valid session found. Manual login required.');
    console.warn('[Playwright] Run: node node_modules/tsx/dist/cli.mjs src/login.ts');
  }
}

async function checkValidSession(): Promise<boolean> {
  if (!activePage) return false;
  try {
    await activePage.goto('https://claude.ai/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(3000);
    const url = activePage.url();
    const isLogged = !url.includes('auth') && !url.includes('login') && !url.includes('signin');
    if (isLogged) {
      console.log('[Playwright] Valid session found.');
    }
    return isLogged;
  } catch {
    return false;
  }
}

export async function closePlaywright() {
  if (context) {
    await context.close();
    context = null;
    activePage = null;
  }
}

export async function loginToClaude(email: string, password: string): Promise<boolean> {
  if (!activePage) throw new Error('Playwright not initialized');

  console.log(`[Playwright] Attempting login for ${email}...`);

  await activePage.goto('https://claude.ai/login', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  try {
    console.log('[Playwright] UI: Filling email...');
    await activePage.fill('input[type="email"], input[placeholder*="email" i]', email);
    await sleep(500);
    await activePage.keyboard.press('Enter');
    await sleep(2000);

    await activePage.waitForSelector('input[type="password"]', { timeout: 10000 });
    console.log('[Playwright] UI: Filling password...');
    await activePage.fill('input[type="password"]', password);
    await activePage.keyboard.press('Enter');

    await sleep(5000);

    const isLogged = !activePage.url().includes('login') && !activePage.url().includes('signin');
    if (isLogged) {
      console.log('[Playwright] Login OK');
      return true;
    }
  } catch (err: any) {
    console.error('[Playwright] Login error:', err.message);
  }

  return false;
}

export async function getClaudeHeaders(forceNew = false): Promise<{ headers: Record<string, string>, sessionId: string }> {
  const release = await uiMutex.acquire();

  try {
    return await _getClaudeHeadersInternal(forceNew);
  } finally {
    release();
  }
}

async function _getClaudeHeadersInternal(forceNew = false): Promise<{ headers: Record<string, string>, sessionId: string }> {
  if (!forceNew && cachedClaudeHeaders && (Date.now() - lastHeadersTime < HEADERS_TTL)) {
    return cachedClaudeHeaders;
  }

  if (sessionFromFile && !activePage) {
    console.log('[Playwright] Server-only mode: refreshing cookies by launching browser...');
    try {
      context = await launchStealthBrowser(true, 'chromium');
      if (sessionFromFile.cookies.length > 0) {
        await context.addCookies(sessionFromFile.cookies);
      }
      activePage = context.pages()[0] || await context.newPage();
      const valid = await checkValidSession();
      if (valid) {
        const freshCookies = await getCookies();
        cachedClaudeHeaders = {
          headers: {
            ...cachedClaudeHeaders?.headers,
            'cookie': freshCookies
          },
          sessionId: ''
        };
        lastHeadersTime = Date.now();

        const allCookies = await activePage.context().cookies();
        fs.writeFileSync(SESSION_FILE, JSON.stringify({
          cookies: allCookies,
          cookieString: freshCookies,
          savedAt: new Date().toISOString()
        }, null, 2));

        console.log('[Playwright] Cookies refreshed and saved.');
        return cachedClaudeHeaders;
      }
    } catch (err: any) {
      console.error('[Playwright] Failed to refresh cookies:', err.message);
      if (context) {
        await context.close();
        context = null;
        activePage = null;
      }
      if (cachedClaudeHeaders) {
        console.log('[Playwright] Falling back to saved cookies...');
        lastHeadersTime = Date.now();
        return cachedClaudeHeaders;
      }
      throw err;
    }
  }

  if (!activePage) {
    throw new Error('Playwright not initialized and no saved session');
  }

  const currentUrl = activePage.url();
  const isOnClaude = currentUrl.includes('claude.ai');

  if (!isOnClaude || forceNew) {
    console.log(`[Playwright] Navigating to Claude home... (Current: ${currentUrl})`);
    await activePage.goto('https://claude.ai/', { waitUntil: 'domcontentloaded' });
  }

  const isLoginPage = activePage.url().includes('login') || activePage.url().includes('signin') || activePage.url().includes('auth');
  if (isLoginPage) {
    throw new Error('Login required. Open browser via VNC or set ANTHROPIC_EMAIL/PASSWORD in .env');
  }

  console.log('[Playwright] Waiting for chat input...');
  const inputSelector = 'textarea:visible, [contenteditable="true"]:visible, [placeholder*="Message" i], div.ProseMirror';

  await activePage.waitForSelector(inputSelector, { timeout: 30000 }).catch(() => {
    console.error('[Playwright] Chat input not found. Current URL:', activePage!.url());
    throw new Error('Timeout waiting for chat input. Are you logged in?');
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for Claude headers'));
    }, 60000);

    const routeHandler = async (route: any, request: any) => {
      clearTimeout(timeout);

      const reqHeaders = request.headers();

      const extractedHeaders: Record<string, string> = {
        'cookie': reqHeaders['cookie'] || '',
        'user-agent': reqHeaders['user-agent'] || '',
        'anthropic-version': reqHeaders['anthropic-version'] || '2023-06-01',
        'anthropic-sentiment-account-id': reqHeaders['anthropic-sentiment-account-id'] || '',
        'x-anthropic-account': reqHeaders['x-anthropic-account'] || ''
      };

      if (!extractedHeaders.cookie) {
        console.log('[Playwright] Intercepted request missing cookies, skipping...');
        await route.continue();
        return;
      }

      console.log('[Playwright] Successfully intercepted headers.');
      cachedClaudeHeaders = { headers: extractedHeaders, sessionId: '' };
      lastHeadersTime = Date.now();

      await route.abort('aborted');
      await activePage!.unroute('**/v1/messages', routeHandler);

      resolve(cachedClaudeHeaders);
    };

    activePage!.route('**/v1/messages', routeHandler).then(async () => {
      console.log('[Playwright] Triggering request...');

      await activePage!.focus(inputSelector);
      await activePage!.fill(inputSelector, '');
      await activePage!.type(inputSelector, 'ping', { delay: 100 });
      await sleep(1500);

      const submitSelectors = [
        'button[type="submit"]',
        '[class*="send"]',
        '[class*="submit"]',
        'button[aria-label*="Send"]',
        '[data-testid="send-button"]'
      ];

      let clicked = false;
      for (const selector of submitSelectors) {
        try {
          const btn = await activePage!.$(selector);
          if (btn && await btn.isVisible()) {
            await btn.click({ force: true });
            clicked = true;
            break;
          }
        } catch {}
      }

      if (!clicked) {
        console.log('[Playwright] No send button found, trying Enter...');
        await activePage!.keyboard.press('Enter');
      }

      await sleep(1000);
    });
  });
}
