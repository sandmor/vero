import { expect, test } from '@playwright/test';

test.describe('E2E runtime smoke', () => {
  test('health endpoint responds', async ({ request }) => {
    const response = await request.get('/ping');

    expect(response.ok()).toBe(true);
    await expect(response.text()).resolves.toBe('pong');
  });

  test('session endpoint returns the E2E guest session', async ({
    request,
  }) => {
    const response = await request.get('/api/session');

    expect(response.ok()).toBe(true);

    const payload = await response.json();
    expect(payload?.session?.user?.id).toBe('e2e-user');
    expect(payload?.session?.user?.type).toBe('guest');
  });

  test('cache encryption key endpoint is available', async ({ request }) => {
    const response = await request.post('/api/cache/encryption-key');

    expect(response.ok()).toBe(true);

    const payload = await response.json();
    expect(typeof payload?.key).toBe('string');
    expect(payload.key.length).toBeGreaterThan(0);
  });
});
