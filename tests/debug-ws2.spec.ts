import { test, expect } from '@playwright/test';

test('debug websocket monitor', async ({ page }) => {
  await page.route('**/*', async (route: any) => {
    if (route.request().resourceType() === 'document') {
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
      return;
    }
    await route.continue();
  });

  page.on('websocket', ws => {
    console.log('[WEBSOCKET DETECTED]', ws.url());
    ws.on('framesent', data => {
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      console.log('[WS SENT]', text.substring(0, 200));
    });
    ws.on('framereceived', data => {
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      console.log('[WS RECV]', text.substring(0, 200));
    });
  });

  await page.goto('/');
  await page.waitForTimeout(3000);
  
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();
  
  await page.waitForTimeout(5000);
});
