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

test('debug dom monitor', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));

  await fixCSP(page);
  await page.goto('/');
  
  await page.evaluate(() => {
    (window as any).__domLog = [];
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if ((node as Element).classList && (node as Element).classList.contains('toast')) {
            (window as any).__domLog.push({ action: 'added', text: (node as Element).textContent, time: Date.now() });
            console.log('[DOM] Toast ADDED:', (node as Element).textContent);
          }
        }
        for (const node of Array.from(m.removedNodes)) {
          if ((node as Element).classList && (node as Element).classList.contains('toast')) {
            (window as any).__domLog.push({ action: 'removed', time: Date.now() });
            console.log('[DOM] Toast REMOVED');
          }
        }
      }
    });
    const container = document.getElementById('toast-container');
    if (container) observer.observe(container, { childList: true });
  });
  
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-missing-profile-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();

  await page.waitForTimeout(15000);
  
  const domLog = await page.evaluate(() => (window as any).__domLog);
  console.log('DOM log:', JSON.stringify(domLog));
});
