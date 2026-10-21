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

async function blockRTDB(page: any) {
  await page.route('**/*firebasedatabase.app**', async (route: any) => {
    const url = route.request().url();
    if (url.includes('.info/connected')) {
      await route.continue();
      return;
    }
    await route.abort('timedout');
  });
}

test('debug offline block before login', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

  await fixCSP(page);
  await page.goto('/');
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-missing-profile-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');

  // Block RTDB BEFORE clicking login
  await blockRTDB(page);
  await page.locator('#btn-login-submit').click();

  // Wait for toast to appear (timeout is 10s, give it 15s)
  const toast = page.locator('.toast');
  await toast.waitFor({ state: 'visible', timeout: 15000 });
  const toastText = await toast.textContent();
  console.log('Toast text:', toastText);

  const state = await page.evaluate(() => ({
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
  }));
  console.log('State:', JSON.stringify(state));
});
