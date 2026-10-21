import { test, expect } from '@playwright/test';

test('debug log all requests', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('firebasedatabase.app')) {
      urls.push(url);
    }
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (url.includes('firebasedatabase.app')) {
      urls.push('FAILED:' + url);
    }
  });
  
  await page.goto('/');
  await page.waitForTimeout(3000);
  
  console.log('RTDB URLs:', JSON.stringify(urls));
});
