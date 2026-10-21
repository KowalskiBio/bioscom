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

test('debug offline after deleting profile', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    console.log(`[${msg.type()}] ${text}`);
  });

  await fixCSP(page);
  await page.goto('/');
  
  // Login
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  await page.locator('#btn-login-submit').click();
  
  await page.waitForTimeout(3000);
  
  // Delete RTDB profile (removes from server + local cache)
  const uid = await page.evaluate(() => auth.currentUser.uid);
  console.log('Deleting profile for uid:', uid);
  await page.evaluate(async (delUid: string) => {
    await db.ref('users/' + delUid).remove();
  }, uid);

  // Log out
  await page.locator('#btn-user-menu').click();
  await page.locator('#btn-logout').click();
  await page.waitForTimeout(1000);

  // Block RTDB
  await page.routeWebSocket('**/*', wsRoute => {
    console.log('[WS OFFLINE] closing');
    wsRoute.close();
  });
  await page.route('**/*firebasedatabase.app*', async route => route.abort('timedout'));

  // Reload
  await page.reload();
  
  // Wait for auth restoration + timeout + .info/connected check
  // Auth restores instantly from localStorage
  // Timeout is 10s, .info/connected check should be fast (< 1s)
  await page.waitForTimeout(13000);
  
  // Check state
  const state = await page.evaluate(() => ({
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find((p: any) => !p.classList.contains('hidden'))?.id,
    toasts: Array.from(document.querySelectorAll('.toast')).map((t: any) => t.textContent),
    authUser: (window as any).firebase?.auth()?.currentUser?.email,
    profileTimeoutId: (window as any)._profileTimeout,
    profileListener: !!(window as any)._profileListener,
    profileUid: (window as any)._profileUid,
  }));
  console.log('State:', JSON.stringify(state));
  
  // Also check if signOut was called
  const signOutCalled = await page.evaluate(() => !!(window as any).__signOutCalled);
  console.log('signOut called:', signOutCalled);
});
