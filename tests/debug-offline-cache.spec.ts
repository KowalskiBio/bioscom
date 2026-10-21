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

test('debug offline after clearing db cache', async ({ page }) => {
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
  
  const overlayClass = await page.evaluate(() => document.getElementById('login-overlay')?.className);
  console.log('Post-login overlay:', overlayClass);

  // Clear Firebase databases to remove cached RTDB data (but keep localStorage for auth persistence)
  await page.evaluate(async () => {
    const deleteDB = (name: string) => new Promise<void>((res, rej) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
      req.onblocked = () => res();
    });
    const dbs = await (window as any).indexedDB.databases?.() || [];
    for (const db of dbs) {
      if (db.name) {
        console.log(`[CLEAR_DB] Deleting ${db.name}`);
        await deleteDB(db.name);
      }
    }
    // Also try known Firebase DB names
    for (const name of ['firebase-installations-database', 'firebase-messaging-database', 'firebaseLocalStorageDb', 'firebase-heartbeat-database']) {
      await deleteDB(name).catch(() => {});
    }
  });

  // Block RTDB
  await page.routeWebSocket('**/*', wsRoute => {
    console.log('[WS OFFLINE] closing');
    wsRoute.close();
  });

  await page.route('**/*firebasedatabase.app*', async route => route.abort('timedout'));

  // Reload
  await page.reload();
  
  // Wait for auth restoration + timeout
  await page.waitForTimeout(13000);
  
  const state = await page.evaluate(() => ({
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
    toasts: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent),
    authUser: (window as any).firebase?.auth()?.currentUser?.email,
    profileResolved: !(window as any)._profileTimeout,
  }));
  console.log('State:', JSON.stringify(state));
});
