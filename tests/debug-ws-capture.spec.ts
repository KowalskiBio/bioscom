import { test } from '@playwright/test';

async function fixCSP(page: any) {
  await page.route('**/*', async (route: any) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    let body = await response.text();
    body = body.replace(
      /connect-src [^;]+/,
      'connect-src https://*.firebaseio.com https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.firebasedatabase.app wss://*.firebasedatabase.app'
    );
    body = body.replace(
      /script-src [^;]+/,
      "script-src 'self' https://www.gstatic.com https://cdn.jsdelivr.net 'unsafe-inline' https://*.firebasedatabase.app"
    );
    await route.fulfill({ status: response.status(), headers: response.headers(), body });
  });
}

test('capture Firebase RTDB WebSocket messages', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

  await fixCSP(page);

  await page.routeWebSocket('**/*', wsRoute => {
    const server = wsRoute.connectToServer();
    wsRoute.onMessage((message: any) => {
      console.log('[C→S]', JSON.stringify(String(message)));
      server.send(message);
    });
    server.onMessage((message: any) => {
      console.log('[S→C]', JSON.stringify(String(message)));
      wsRoute.send(message);
    });
  });

  await page.goto('/');
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();

  await page.waitForSelector('#login-overlay.hidden', { timeout: 20000 });
  console.log('Login succeeded, capturing a few more seconds of WS traffic...');
  await page.waitForTimeout(3000);
});
