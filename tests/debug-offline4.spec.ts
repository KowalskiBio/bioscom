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

test('debug offline new page', async ({ context }) => {
  // Step 1: Login on a page to establish auth persistence
  const page1 = await context.newPage();
  page1.on('console', msg => console.log(`[page1 ${msg.type()}] ${msg.text()}`));
  
  await fixCSP(page1);
  await page1.goto('/');
  await page1.locator('#btn-to-login').click();
  await page1.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
  await page1.locator('#login-password-field').fill('E2ETestPass123!');
  await page1.locator('#btn-login-submit').click();
  await expect(page1.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });
  console.log('Login succeeded on page1');
  
  // Step 2: Set offline and open a new page
  await context.setOffline(true);
  const page2 = await context.newPage();
  page2.on('console', msg => console.log(`[page2 ${msg.type()}] ${msg.text()}`));
  
  await fixCSP(page2);
  await page2.goto('/');
  
  // Wait for timeout (10s) + buffer
  await page2.waitForTimeout(15000);
  
  const state = await page2.evaluate(() => ({
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
    toasts: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent),
    currentUser: (window as any).firebase?.auth()?.currentUser?.email,
  }));
  console.log('Page2 offline state after 15s:', JSON.stringify(state));
});
