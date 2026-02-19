import { expect, test } from '@playwright/test';

test.describe('Chat route smoke', () => {
  test('chat route serves html shell', async ({ request }) => {
    const response = await request.get('/chat');

    expect(response.ok()).toBe(true);
    const contentType = response.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/html');
  });

  test('session endpoint remains available from chat smoke suite', async ({
    request,
  }) => {
    const response = await request.get('/api/session');

    expect(response.ok()).toBe(true);
    const payload = await response.json();
    expect(payload?.session?.user?.id).toBe('e2e-user');
  });
});
