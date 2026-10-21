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

test('debug onAuth trace init', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => {
    logs.push(msg.text());
    console.log(`[${msg.type()}] ${msg.text()}`);
  });

  await fixCSP(page);
  await page.addInitScript(() => {
    (window as any).__authLogs = [];
    const orig = (window as any).Object.defineProperty;
    // We'll log by overriding firebase.auth after it loads
    const check = setInterval(() => {
      if ((window as any).firebase && (window as any).firebase.auth) {
        clearInterval(check);
        const auth = (window as any).firebase.auth();
        const origOnAuth = auth.onAuthStateChanged.bind(auth);
        auth.onAuthStateChanged = function(cb: any) {
          return origOnAuth((user: any) => {
            (window as any).__authLogs.push('onAuth:' + (user ? user.email : 'null'));
            console.log('[AUTH_STATE_CHANGE] user=' + (user ? user.email : 'null'));
            cb(user);
          });
        };
      }
    }, 100);
  });

  await page.goto('/');
  await page.waitForTimeout(2000);
  
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-missing-profile-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();

  await page.waitForTimeout(10000);
  
  const authLogs = await page.evaluate(() => (window as any).__authLogs);
  console.log('Auth logs:', JSON.stringify(authLogs));
});
