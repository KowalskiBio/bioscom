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

test('diagnose missing profile flow', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

  await fixCSP(page);
  await page.goto('/');

  const joinCode = await page.evaluate(async () => {
    const snap = await db.ref('groups').once('value');
    const groups = snap.val();
    if (!groups) return null;
    const g = Object.values(groups).find((x: any) => x.joinCode) as any;
    return g ? g.joinCode : null;
  });

  const uniqueEmail = `e2e-diag-${Date.now()}@example.com`;
  const password = 'TestPass123!';

  // Register
  await page.locator('#btn-to-register-user').click();
  await page.locator('#reg-user-name').fill('E2E Diag');
  await page.locator('#reg-user-email').fill(uniqueEmail);
  await page.locator('#reg-user-password').fill(password);
  await page.locator('#reg-user-code').fill(joinCode);
  await page.locator('#btn-reg-user-submit').click();

  await page.waitForSelector('#login-overlay.hidden', { timeout: 20000 });
  console.log('Registration succeeded');

  // Delete profile
  await page.evaluate(async () => {
    const uid = auth.currentUser.uid;
    await db.ref('users/' + uid).remove();
    console.log('Profile deleted for uid', uid);
  });

  // Logout
  await page.locator('#btn-user-menu').click();
  await page.locator('#btn-logout').click();
  await page.waitForSelector('#login-overlay', { state: 'visible', timeout: 10000 });
  console.log('Logged out');

  // Reload for clean state
  await fixCSP(page);
  await page.goto('/');

  // Login again
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill(uniqueEmail);
  await page.locator('#login-password-field').fill(password);
  await page.locator('#btn-login-submit').click();
  console.log('Login submitted');

  // Poll for 15s
  for (let t = 1; t <= 15; t++) {
    await page.waitForTimeout(1000);
    const snapshot = await page.evaluate(() => ({
      overlayClass: document.getElementById('login-overlay')?.className,
      visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
      toasts: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent),
      authEmail: (window as any).firebase?.auth()?.currentUser?.email || null,
      authUid: (window as any).firebase?.auth()?.currentUser?.uid || null,
    }));
    console.log(`t=${t}s:`, JSON.stringify(snapshot));
  }
});
