import { test, expect } from '@playwright/test';

test('debug auth', async ({ page }) => {
  page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));
  page.on('request', req => console.log(`[REQUEST] ${req.method()} ${req.url()}`));
  page.on('requestfailed', req => console.log(`[REQUEST FAILED] ${req.url()}: ${req.failure()?.errorText}`));
  
  await page.goto('/');
  await page.locator('#btn-to-login').click();
  await page.locator('#login-email').fill('e2e-test-auth-bioscom@example.com');
  await page.locator('#login-password-field').fill('E2ETestPass123!');
  
  const beforeVals = await page.evaluate(() => ({
    email: (document.getElementById('login-email') as HTMLInputElement)?.value,
    password: (document.getElementById('login-password-field') as HTMLInputElement)?.value,
  }));
  console.log('Before click values:', JSON.stringify(beforeVals));
  
  await page.locator('#btn-login-submit').click();
  
  // Wait for any auth activity
  await page.waitForTimeout(8000);
  
  const afterVals = await page.evaluate(() => ({
    errorText: document.getElementById('auth-login-error')?.textContent,
    errorVisible: document.getElementById('auth-login-error')?.classList.contains('visible'),
    overlayClass: document.getElementById('login-overlay')?.className,
    visiblePanel: Array.from(document.querySelectorAll('.login-card')).find(p => !p.classList.contains('hidden'))?.id,
    currentUser: (window as any).firebase?.auth()?.currentUser?.email,
  }));
  console.log('After 8s state:', JSON.stringify(afterVals));
});
