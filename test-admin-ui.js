import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Inspect App.jsx / AppShell to see how roles are handled in DEV mode
  // Or bypass login by setting mock auth in local storage
  await page.addInitScript(() => {
    const mockUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin@test.com',
      role: 'admin',
      user_metadata: { role: 'admin' }
    };
    window.localStorage.setItem('sb-test-auth-token', JSON.stringify({
      access_token: 'mock-token',
      user: mockUser
    }));
  });

  await page.goto('http://localhost:4173');
  await page.waitForTimeout(1000);

  await page.screenshot({ path: '/home/jules/verification/screenshots/admin_system_monitor.png' });
  await browser.close();
})();
