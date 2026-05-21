import * as dotenv from 'dotenv';
import { initPlaywright, closePlaywright, getCookies } from './services/playwright.js';
import * as fs from 'fs';

dotenv.config();

async function main() {
  console.log('ClaudeProxy Login Tool');
  console.log('A browser will open - log in to claude.ai manually.');
  console.log('After login, press Enter here to save the session.\n');

  await initPlaywright(false, 'chrome');

  console.log('\nWaiting for login...');
  console.log('Press ENTER after you are logged in to claude.ai...');

  await new Promise<void>(resolve => {
    process.stdin.once('data', () => resolve());
  });

  const cookies = await getCookies();
  const page = (await import('./services/playwright.js')).activePage;
  const allCookies = page ? await page.context().cookies() : [];

  const sessionData = {
    cookies: allCookies,
    cookieString: cookies,
    savedAt: new Date().toISOString()
  };

  fs.writeFileSync('session.json', JSON.stringify(sessionData, null, 2));
  console.log('\nSession saved to session.json!');
  console.log(`Cookie string length: ${cookies.length}`);
  console.log('This file will be used by the server on Render.');

  await closePlaywright();
  process.exit(0);
}

main().catch(console.error);
