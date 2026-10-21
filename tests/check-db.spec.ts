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

test('check info connected after login', async ({ page }) => {
  test.setTimeout(30000);
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  await fixCSP(page);
  await page.goto('/');
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill(process.env.TEST_EMAIL!);
  await page.locator('#login-password-field').fill(process.env.TEST_PASSWORD!);
  await page.locator('#btn-login-submit').click();
  await page.waitForSelector('#app-header', { state: 'visible', timeout: 20000 });
  console.log('Logged in');

  const connected = await page.evaluate(async () => {
    const snap = await db.ref('.info/connected').once('value');
    return snap.val();
  });
  console.log('.info/connected after login:', connected);
});
