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

async function performLogin(page: any, email: string, password: string) {
  await fixCSP(page);
  await page.goto('/');
  await expect(page.locator('#login-overlay')).toBeVisible();
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password-field').fill(password);
  await page.locator('#btn-login-submit').click();
}

test('debug offline with correct route', async ({ page }) => {
  test.setTimeout(45000);
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('websocket', ws => console.log('WS created:', ws.url()));
  page.on('request', req => {
    const url = req.url();
    if (url.includes('firebasedatabase') || url.includes('firebaseio')) {
      console.log('REQUEST:', req.method(), url.substring(0, 120));
    }
  });
  page.on('response', res => {
    const url = res.url();
    if (url.includes('firebasedatabase') || url.includes('firebaseio')) {
      console.log('RESPONSE:', res.status(), url.substring(0, 120));
    }
  });
  await performLogin(page, process.env.TEST_EMAIL!, process.env.TEST_PASSWORD!);
  await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });

  await page.routeWebSocket('**/*', wsRoute => {
    console.log('WS route hit');
    wsRoute.close();
  });
  await page.route('**/*.firebasedatabase.app/**', async route => {
    console.log('HTTP route hit:', route.request().url());
    route.abort('timedout');
  });

  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.waitForTimeout(12000);

  const state = await page.evaluate(() => ({
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(c => !c.classList.contains('hidden'))?.id,
    role: window.currentUserRole,
    toasts: document.getElementById('toast-container')?.textContent,
  }));
  console.log('State after 12s:', JSON.stringify(state));
});
