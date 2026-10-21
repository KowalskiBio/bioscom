import { test, expect } from '@playwright/test';

test('debug scope', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => logs.push(msg.text()));
  
  await page.setContent(`
    <script>const foo = 42;</script>
    <script>console.log('foo is:', typeof foo, foo);</script>
  `);
  await page.waitForTimeout(500);
  
  console.log('Logs:', logs);
});
