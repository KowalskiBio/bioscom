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

test('debug offline fresh', async ({ page, context }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('requestfailed', req => console.log(`[REQUEST FAILED] ${req.url()}: ${req.failure()?.errorText}`));

  await context.setOffline(true);
  await fixCSP(page);
  
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 5000 });
  } catch (e) {
    console.log('Goto failed (expected offline):', (e as Error).message);
  }
  
  // Wait a bit and check what's on the page
  await page.waitForTimeout(2000);
  
  const state = await page.evaluate(() => ({
    url: location.href,
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
    hasFirebase: typeof (window as any).firebase !== 'undefined',
  }));
  console.log('Fresh offline state:', JSON.stringify(state));
  
  // If page loaded somehow, try logging in
  if (state.hasFirebase) {
    await page.locator('#btn-to-login').click();
    await page.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
    await page.locator('#login-password-field').fill('E2ETestPass123!');
    await page.locator('#btn-login-submit').click();
    await page.waitForTimeout(5000);
    
    const loginState = await page.evaluate(() => ({
      errorText: document.getElementById('auth-login-error')?.textContent,
      errorVisible: document.getElementById('auth-login-error')?.classList.contains('visible'),
      toasts: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent),
    }));
    console.log('Login attempt state:', JSON.stringify(loginState));
  }
});
