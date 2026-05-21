import * as dotenv from 'dotenv';
import { initPlaywright, loginToClaude, BrowserType } from './services/playwright.js';

dotenv.config();

const browserArg = process.argv.find(arg => arg.startsWith('--browser='));
let browserType: BrowserType = 'chromium';
if (browserArg) {
  browserType = browserArg.split('=')[1] as BrowserType;
} else if (process.env.BROWSER) {
  browserType = process.env.BROWSER as BrowserType;
}

async function main() {
  console.log('🚀 ClaudeProxy Login Tool');
  console.log(`Browser: ${browserType}\n`);

  await initPlaywright(false, browserType);

  const email = process.env.ANTHROPIC_EMAIL;
  const password = process.env.ANTHROPIC_PASSWORD;

  if (!email || !password) {
    console.log('⚠️  No credentials in .env');
    console.log('Please enter credentials when browser opens...\n');
  } else {
    console.log(`📧 Logging in as: ${email}`);
    const success = await loginToClaude(email, password);
    if (success) {
      console.log('\n✅ Login successful!');
      console.log('Session saved to claudeproxy/ directory');
    } else {
      console.log('\n❌ Login failed');
    }
  }

  console.log('\nPress Ctrl+C to exit');
  
  process.stdin.resume();
}

main().catch(console.error);