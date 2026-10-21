import { test, expect } from '@playwright/test';

async function fixCSPAndDelayRTDB(page: any, delayMs: number = 0) {
  await page.route('**/*', async (route: any) => {
    const url = route.request().url();
    const resourceType = route.request().resourceType();
    
    // Fix CSP for HTML documents
    if (resourceType === 'document') {
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
    
    // Delay or block RTDB requests
    if (url.includes('firebasedatabase.app')) {
      if (delayMs > 0) {
        console.log('[DELAY]', url);
        await new Promise(r => setTimeout(r, delayMs));
        await route.continue();
      } else {
        console.log('[BLOCK]', url);
        await route.abort('timedout');
      }
      return;
    }
    
    await route.continue();
  });
}

test('debug delay rtdb with profile user', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

  await fixCSPAndDelayRTDB(page, 15000); // delay RTDB by 15s
  await page.goto('/');
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();

  // Wait for toast to appear (timeout is 10s, but profile data is delayed 15s)
  const toast = page.locator('.toast');
  await toast.waitFor({ state: 'visible', timeout: 20000 });
  const toastText = await toast.textContent();
  console.log('Toast text:', toastText);

  const state = await page.evaluate(() => ({
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
  }));
  console.log('State:', JSON.stringify(state));
});
