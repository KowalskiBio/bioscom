import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length > 0) {
      const value = rest.join('=').trim();
      if (value && !process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  }
}

const TEST_EMAIL = process.env.TEST_EMAIL;
const TEST_PASSWORD = process.env.TEST_PASSWORD;

if (!TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error(
    'TEST_EMAIL and TEST_PASSWORD environment variables must be set. ' +
    'Copy .env.example to .env and fill in real credentials.'
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * The production CSP meta tag does not include *.firebasedatabase.app,
 * which blocks RTDB WebSocket and long-polling requests in Chromium.
 * We intercept the main document and relax the CSP only for the test.
 */
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

async function getValidJoinCode(page: any): Promise<string> {
  await page.waitForFunction(() => typeof db !== 'undefined');
  const code = await page.evaluate(async () => {
    const snap = await db.ref('groups').once('value');
    const groups = snap.val();
    if (!groups) return null;
    const g = Object.values(groups).find((x: any) => x.joinCode) as any;
    return g ? g.joinCode : null;
  });
  if (!code) throw new Error('No valid join code found in RTDB');
  return code;
}

async function watchSignOut(page: any): Promise<() => Promise<boolean>> {
  await page.waitForFunction(() => typeof auth !== 'undefined');
  await page.evaluate(() => {
    const orig = auth.signOut.bind(auth);
    auth.signOut = function (...args: any[]) {
      (window as any).__signOutCalled = true;
      return orig.apply(auth, args);
    };
  });
  return async () => page.evaluate(() => !!(window as any).__signOutCalled);
}

async function performLogin(page: any, email: string, password: string) {
  await fixCSP(page);
  await page.goto('/');
  const loginOverlay = page.locator('#login-overlay');
  await expect(loginOverlay).toBeVisible();
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password-field').fill(password);
  await page.locator('#btn-login-submit').click();
}

async function logout(page: any) {
  await page.locator('#btn-user-menu').click();
  await page.locator('#btn-logout').click();
  await expect(page.locator('#login-overlay')).toBeVisible({ timeout: 10000 });
}

/* ------------------------------------------------------------------ */
/* Serial configuration – guarantees beforeAll runs once              */
/* ------------------------------------------------------------------ */

test.describe.configure({ mode: 'serial' });

test.describe('Authentication', () => {
  /* ---------------------------------------------------------------- */
  /* One-time setup: ensure TEST_EMAIL exists in Firebase Auth+RTDB   */
  /* ---------------------------------------------------------------- */
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await fixCSP(page);
      await page.goto('/');
      await page.waitForFunction(() => typeof firebase !== 'undefined' && typeof db !== 'undefined');

      const joinCode = await getValidJoinCode(page);

      // Look up the groupId that matches the join code
      const groupId = await page.evaluate(async (code: string) => {
        const snap = await db.ref('groups').once('value');
        const groups = snap.val();
        if (!groups) return null;
        const entry = Object.entries(groups).find(([_, g]: [string, any]) =>
          g.joinCode && g.joinCode.toUpperCase() === code.toUpperCase()
        );
        return entry ? entry[0] : null;
      }, joinCode);

      if (!groupId) throw new Error('Setup: no group found for join code');

      let uid: string | null = null;

      try {
        uid = await page.evaluate(async ({ email, password }: any) => {
          const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
          return cred.user.uid;
        }, { email: TEST_EMAIL, password: TEST_PASSWORD });
      } catch (e: any) {
        const msg = e.message || '';
        if (msg.includes('already in use')) {
          // Try to sign in to obtain the uid
          uid = await page.evaluate(async ({ email, password }: any) => {
            const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
            return cred.user.uid;
          }, { email: TEST_EMAIL, password: TEST_PASSWORD });
        } else {
          throw new Error('Setup: failed to create test user – ' + msg);
        }
      }

      if (!uid) throw new Error('Setup: could not obtain UID');

      // Ensure the RTDB profile exists
      await page.evaluate(async ({ uid, email, gid }: any) => {
        const existing = await db.ref('users/' + uid).once('value');
        if (!existing.val()) {
          await db.ref('users/' + uid).set({
            name: 'E2E Test User',
            email,
            groupId: gid,
            role: 'reader'
          });
        }
      }, { uid, email: TEST_EMAIL, gid: groupId });

      // Clean logout so later tests start fresh
      await page.evaluate(() => firebase.auth().signOut());
    } catch (err: any) {
      console.error('[beforeAll] Test-user setup failed:', err.message);
      throw err;
    } finally {
      await page.close();
    }
  });

  /* 1. Happy path */
  test('happy path – existing user can log in', async ({ page }) => {
    await performLogin(page, TEST_EMAIL, TEST_PASSWORD);

    await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });
    await expect(page.locator('#app-header')).toBeVisible();
    await expect(page.locator('#view-rooms')).toHaveClass(/active/);

    await page.screenshot({ path: '.omo/evidence/task-12-happy-path.png' });
  });

  /* 2. Slow network retry */
  test('slow network retry – login succeeds despite 5s RTDB delay', async ({ page }) => {
    await page.route('**/*.json', route => setTimeout(() => route.continue(), 5000));
    await performLogin(page, TEST_EMAIL, TEST_PASSWORD);

    await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });
    await expect(page.locator('#app-header')).toBeVisible();
    await expect(page.locator('#view-rooms')).toHaveClass(/active/);

    await page.screenshot({ path: '.omo/evidence/task-12-slow-network.png' });
  });

  /* 3. Registration flow */
  test('registration flow – Join a Lab registers user and loads app', async ({ page }) => {
    test.setTimeout(35000);
    await fixCSP(page);
    await page.goto('/');
    const joinCode = await getValidJoinCode(page);
    const uniqueEmail = `e2e-reg-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const name = 'E2E Test User';

    await expect(page.locator('#login-overlay')).toBeVisible();
    await page.locator('#btn-to-register-user').click();
    await expect(page.locator('#auth-panel-register-user')).not.toHaveClass(/hidden/);

    await page.locator('#reg-user-name').fill(name);
    await page.locator('#reg-user-email').fill(uniqueEmail);
    await page.locator('#reg-user-password').fill(password);
    await page.locator('#reg-user-code').fill(joinCode);
    await page.locator('#btn-reg-user-submit').click();

    await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });
    await expect(page.locator('#app-header')).toBeVisible();
    await expect(page.locator('#view-rooms')).toHaveClass(/active/);

    // Confirm success toast
    await expect(page.locator('#toast-container')).toContainText(
      'Account registered and joined lab successfully!'
    );

    await page.screenshot({ path: '.omo/evidence/task-12-registration.png' });
  });

  /* 4. Missing profile error */
  test('missing profile error – user without RTDB profile shows error toast and does NOT signOut', async ({ page }) => {
    test.setTimeout(60000);
    await fixCSP(page);
    await page.goto('/');
    const joinCode = await getValidJoinCode(page);
    const uniqueEmail = `e2e-missing-${Date.now()}@example.com`;
    const password = 'TestPass123!';
    const name = 'E2E Missing Profile';

    await page.locator('#btn-to-register-user').click();
    await page.locator('#reg-user-name').fill(name);
    await page.locator('#reg-user-email').fill(uniqueEmail);
    await page.locator('#reg-user-password').fill(password);
    await page.locator('#reg-user-code').fill(joinCode);
    await page.locator('#btn-reg-user-submit').click();

    await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });

    const uid = await page.evaluate(() => auth.currentUser.uid);

    await logout(page);

    await page.routeWebSocket('**/*', wsRoute => {
      const server = wsRoute.connectToServer();
      wsRoute.onMessage(msg => {
        try {
          const text = String(msg);
          const obj = JSON.parse(text);
          if (
            obj.t === 'd' &&
            obj.d?.a === 'q' &&
            obj.d?.b?.p
          ) {
            const p = obj.d.b.p;
            if (p === `users/${uid}` || p === `/users/${uid}`) {
              obj.d.b.p = `users/${uid}_nonexistent`;
              server.send(JSON.stringify(obj));
              return;
            }
          }
        } catch {}
        server.send(msg);
      });
      server.onMessage(msg => wsRoute.send(msg));
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.locator('#btn-to-login').click();
    await page.locator('#login-email').fill(uniqueEmail);
    await page.locator('#login-password-field').fill(password);
    await page.locator('#btn-login-submit').click();

    const wasSignOutCalled = await watchSignOut(page);

    await expect(page.locator('#toast-container')).toContainText(
      'Account profile not found. Please contact your lab administrator.',
      { timeout: 15000 }
    );

    expect(await wasSignOutCalled()).toBe(false);
  });

  /* 5. Offline behavior */
  test('offline behavior – shows offline message on reload, no signOut attempt', async ({ page }) => {
    test.setTimeout(45000);

    // Pre-condition: logged-in session cached by Firebase
    await performLogin(page, TEST_EMAIL, TEST_PASSWORD);
    await expect(page.locator('#login-overlay')).toHaveClass(/hidden/, { timeout: 20000 });
    await expect(page.locator('#app-header')).toBeVisible();

    // Spy on signOut BEFORE blocking RTDB so we catch any call during the timeout path
    const wasSignOutCalled = await watchSignOut(page);

    // Block RTDB (WebSocket + long-polling REST) while keeping Auth APIs reachable
    await page.routeWebSocket('**/*', wsRoute => wsRoute.close());
    await page.route('**/*.firebasedatabase.app/**', async route => route.abort('timedout'));

    // Reload page – Firebase Auth restores from localStorage without network,
    // RTDB profile listener will hang and the 10 s timeout path fires
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for the offline toast from the onAuthStateChanged timeout path
    await expect(page.locator('#toast-container')).toContainText(
      'You are offline. Please check your internet connection.',
      { timeout: 15000 }
    );

    // Assert signOut was NOT called ( ensuring the old buggy behaviour is gone )
    expect(await wasSignOutCalled()).toBe(false);

    await page.screenshot({ path: '.omo/evidence/task-12-offline.png' });
  });
});
