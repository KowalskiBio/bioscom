import { test, expect } from '@playwright/test';

async function fixCSP(page: any) {
  await page.route('**/*', async (route: any) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace(
      'connect-src https://*.firebaseio.com https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;',
      'connect-src https://*.firebaseio.com https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebasedatabase.app wss://*.firebasedatabase.app;'
    );
    body = body.replace(
      "script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net 'unsafe-inline';",
      "script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net 'unsafe-inline' https://*.firebasedatabase.app;"
    );
    await route.fulfill({ status: response.status(), headers: response.headers(), body });
  });
}

test('debug block websocket before load', async ({ page }) => {
  const blocked: string[] = [];
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('requestfailed', req => {
    if (req.url().includes('firebasedatabase.app')) {
      blocked.push(req.url());
    }
  });
  
  await page.route('**/*firebasedatabase.app**', async (route: any) => {
    console.log('[BLOCKED]', route.request().url());
    await route.abort('timedout');
  });
  
  await fixCSP(page);
  await page.goto('/');
  
  await page.waitForTimeout(5000);
  console.log('Blocked URLs:', blocked.length);
});
