import { test, expect } from '@playwright/test';

test('debug auth direct', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));
  
  await page.goto('/');
  await page.waitForTimeout(3000);
  
  const result = await page.evaluate(async ({ email, password }) => {
    try {
      const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
      return { success: true, uid: cred.user.uid };
    } catch (e: any) {
      return { success: false, error: e.message, code: e.code };
    }
  }, { email: 'e2e-test-auth-bioscom@example.com', password: 'E2ETestPass123!' });
  
  console.log('Auth result:', JSON.stringify(result));
});
