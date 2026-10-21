import { test, expect } from '@playwright/test';

test('debug log route requests', async ({ page }) => {
  await page.route('**/*', async (route: any) => {
    const url = route.request().url();
    const resourceType = route.request().resourceType();
    console.log('[ROUTE]', resourceType, url.substring(0, 120));
    await route.continue();
  });
  
  await page.goto('/');
  await page.waitForTimeout(3000);
});
