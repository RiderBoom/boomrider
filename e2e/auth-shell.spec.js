import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:54321/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/token')) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_grant"}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
});

test('renders the login shell without exposing server credentials', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'BoomRider' })).toBeVisible();
  await expect(page.getByLabel('อีเมล')).toBeVisible();
  await expect(page.getByLabel(/รหัสผ่าน|Password/)).toBeVisible();

  const html = await page.locator('html').innerHTML();
  expect(html).not.toContain('GEMINI_API_KEY');
  expect(html).not.toContain('generativelanguage.googleapis.com');
});

test('switches between login, registration, and password-help states', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /สมัครใช้งาน|Register/ }).click();
  await expect(page.getByLabel(/ชื่อ-นามสกุล|Full name/)).toBeVisible();
  await expect(page.locator('#register-confirm-password')).toBeVisible();

  await page.getByRole('button', { name: /เข้าสู่ระบบ|Login/ }).click();
  await page.getByRole('button', { name: /ลืมรหัสผ่าน|Forgot password/ }).click();
  await expect(page.getByRole('heading', { name: 'ลืมรหัสผ่าน?' })).toBeVisible();
  await page.getByRole('button', { name: 'รับทราบ' }).click();
  await expect(page.getByRole('heading', { name: 'ลืมรหัสผ่าน?' })).toBeHidden();
});
