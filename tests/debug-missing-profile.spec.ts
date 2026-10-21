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

async function getValidJoinCode(page: any): Promise<string> {
  await page.waitForFunction(() => typeof db !== 'undefined');
  const code = await page.evaluate(async () => {
    const snap = await db.ref('groups').once('value');
    const groups = snap.val();
    if (!groups) return null;
    const g = Object.values(groups).find((x: any) => x.joinCode) as any;
    return g ? g.joinCode : null;
  });
  if (!code) throw new Error('No valid join code found in RTDB');
  return code;
}

test('debug showToast patch', async ({ page }) => {
  test.setTimeout(60000);
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  await fixCSP(page);
  await page.goto('/');
  const joinCode = await getValidJoinCode(page);
  const uniqueEmail = `e2e-debug-${Date.now()}@example.com`;
  const password = 'TestPass123!';
  const name = 'Debug User';

  await page.locator('#btn-to-register-user').click();
  await page.locator('#reg-user-name').fill(name);
  await page.locator('#reg-user-email').fill(uniqueEmail);
  await page.locator('#reg-user-password').fill(password);
  await page.locator('#reg-user-code').fill(joinCode);
  await page.locator('#btn-reg-user-submit').click();
  await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });

  await page.evaluate(async () => {
    const uid = auth.currentUser.uid;
    await db.ref('users/' + uid).remove();
  });

  await page.evaluate(() => {
    const orig = showToast;
    (window as any).__toastCalls = [];
    (window as any).showToast = function(msg: string, type: string) {
      (window as any).__toastCalls.push({ msg, type, time: Date.now() });
      return orig(msg, type);
    };
  });

  await page.locator('#btn-user-menu').click();
  await page.locator('#btn-logout').click();
  await expect(page.locator('#login-overlay')).toBeVisible({ timeout: 10000 });

  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill(uniqueEmail);
  await page.locator('#login-password-field').fill(password);
  await page.locator('#btn-login-submit').click();

  await page.waitForTimeout(15000);

  const calls = await page.evaluate(() => (window as any).__toastCalls);
  console.log('showToast calls:', JSON.stringify(calls));
});
