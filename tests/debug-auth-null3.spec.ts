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

test('debug auth null trace wrapped', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

  await fixCSP(page);
  await page.goto('/');
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-missing-profile-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();

  for (let t = 1; t <= 10; t++) {
    await page.waitForTimeout(1000);
    const result = await page.evaluate(() => {
      try {
        const auth = (window as any).firebase?.auth();
        return {
          ok: true,
          hasFirebase: !!(window as any).firebase,
          hasAuth: !!auth,
          currentUserEmail: auth?.currentUser?.email || null,
          currentUserUid: auth?.currentUser?.uid || null,
        };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    });
    console.log(`t=${t}s:`, JSON.stringify(result));
  }
});
