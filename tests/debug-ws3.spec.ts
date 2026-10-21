import { test, expect } from '@playwright/test';

test('debug routeWebSocket', async ({ page }) => {
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

  page.routeWebSocket('**/*', wsRoute => {
    console.log('[WS ROUTE] matched');
    const server = wsRoute.connectToServer();
    wsRoute.onMessage((message: any) => {
      console.log('[WS CLIENT]', String(message).substring(0, 100));
      server.send(message);
    });
    server.onMessage((message: any) => {
      const text = String(message);
      console.log('[WS SERVER]', text.substring(0, 100));
      wsRoute.send(message);
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
