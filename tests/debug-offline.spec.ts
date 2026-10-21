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

test('debug offline', async ({ page, context }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('requestfailed', req => console.log(`[REQUEST FAILED] ${req.url()}: ${req.failure()?.errorText}`));

  await fixCSP(page);
  await page.goto('/');
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();
  
  // Wait for successful login
  await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });
  
  console.log('Login succeeded, going offline...');
  await context.setOffline(true);
  await page.reload();
  
  // Wait for initialization
  await page.waitForTimeout(3000);
  
  // Check state after reload while offline
  const state = await page.evaluate(() => ({
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
    toasts: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent),
    currentUser: (window as any).firebase?.auth()?.currentUser?.email,
  }));
  console.log('Offline state after 3s:', JSON.stringify(state));
  
  // Also try reading .info/connected directly
  const infoConnected = await page.evaluate(() => {
    return new Promise((resolve) => {
      const fb = (window as any).firebase;
      if (!fb) return resolve('firebase not loaded');
      const ref = fb.database().ref('.info/connected');
      ref.once('value', snap => {
        resolve(snap.val());
      });
      setTimeout(() => resolve('timeout'), 5000);
    });
  });
  console.log('.info/connected value:', infoConnected);
});
