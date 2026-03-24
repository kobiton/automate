// manual-test.js — Simulates manual tester behavior: navigate, tap, type, scroll
// Hub URL and capabilities are injected by startAppiumSession via env vars.

import { remote } from 'webdriverio';

const hubUrl = process.env.KOBITON_HUB_URL || 'http://localhost:4723/wd/hub';
const capabilities = JSON.parse(process.env.KOBITON_CAPABILITIES || '{}');

async function run() {
  const browser = await remote({
    logLevel: 'warn',
    protocol: new URL(hubUrl).protocol.replace(':', ''),
    hostname: new URL(hubUrl).hostname,
    port: Number(new URL(hubUrl).port) || (new URL(hubUrl).protocol === 'https:' ? 443 : 80),
    path: new URL(hubUrl).pathname,
    capabilities,
  });

  const { width, height } = await browser.getWindowSize();
  const cx = Math.floor(width / 2);

  // 1. Navigate to Google
  console.log('Navigating to Google...');
  await browser.url('https://www.google.com');
  await browser.pause(2000);

  // 2. Tap center of screen (search area)
  console.log('Tapping search area...');
  await browser.action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: cx, y: Math.floor(height * 0.4) })
    .down().up().perform();
  await browser.pause(1500);

  // 3. Type a search query
  console.log('Typing search query...');
  await browser.keys('Kobiton mobile testing');
  await browser.pause(1500);

  // 4. Submit search
  console.log('Submitting search...');
  await browser.keys('\n');
  await browser.pause(3000);

  // 5. Scroll down through results (3 swipes)
  for (let i = 0; i < 3; i++) {
    console.log(`Swipe down ${i + 1}/3...`);
    await browser.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: cx, y: Math.floor(height * 0.75) })
      .down()
      .move({ x: cx, y: Math.floor(height * 0.25), duration: 500 })
      .up()
      .perform();
    await browser.pause(1500);
  }

  // 6. Tap a result
  console.log('Tapping a result...');
  await browser.action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: cx, y: Math.floor(height * 0.4) })
    .down().up().perform();
  await browser.pause(3000);

  // 7. Scroll down on the page
  console.log('Scrolling the page...');
  await browser.action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: cx, y: Math.floor(height * 0.75) })
    .down()
    .move({ x: cx, y: Math.floor(height * 0.25), duration: 500 })
    .up()
    .perform();
  await browser.pause(2000);

  console.log('Manual-like test completed (~20s of interaction)');
  await browser.deleteSession();
}

run().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
