import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';
import { openChat, TEXT_MODEL, VISION_MODEL } from './chat-helpers';

test.describe.configure({ mode: 'serial' });

test('multimodal composer sends attachments and resets state', async ({
  page,
}) => {
  await openChat(page);

  await page.getByTestId('multimodal-input').fill('Hello world');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('attachments-button').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'file.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('example file content'),
  });

  const attachmentsPreview = page.locator(
    '[data-testid="attachments-preview"]'
  );
  await expect(attachmentsPreview).toBeVisible();
  await expect(attachmentsPreview).toContainText('file.txt');

  await page.getByTestId('send-button').click();

  await expect(page.getByTestId('multimodal-input')).toHaveValue('');
  await expect(attachmentsPreview).toHaveCount(0, { timeout: 15_000 });

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const requests = window.__testMocks?.chatRequests ?? [];
        return requests.length ? requests[requests.length - 1].body : null;
      });
    })
    .not.toBeNull();

  const requestBody = await page.evaluate(() => {
    const requests = window.__testMocks?.chatRequests ?? [];
    return requests.length ? requests[requests.length - 1].body : '';
  });

  expect(requestBody).toContain('"type":"file"');
  expect(requestBody).toContain('"mediaType":"text/plain"');
  expect(requestBody).toContain('"file.txt"');
  expect(requestBody).toContain('"text":"Hello world"');
});

test('attachments are disabled when the active model lacks support', async ({
  page,
}) => {
  await openChat(page, {
    bootstrap: {
      initialChatModel: TEXT_MODEL.id,
      allowedModels: [TEXT_MODEL],
    },
  });

  const attachmentsButton = page.getByTestId('attachments-button');
  await expect(attachmentsButton).toBeDisabled();
  await expect(attachmentsButton).toHaveAttribute(
    'title',
    'Attachments are disabled for this model.'
  );

  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeDisabled();
});

test('models that cannot handle attachments stay disabled while files are present', async ({
  page,
}) => {
  await openChat(page);

  await expect(page.getByTestId('attachments-button')).toBeEnabled({
    timeout: 15_000,
  });

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('attachments-button').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'diagram.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fake image data'),
  });

  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => window.__testMocks?.uploadRequests.length ?? 0
        )
    )
    .toBeGreaterThan(0);

  const attachmentsPreview = page.locator(
    '[data-testid="attachments-preview"]'
  );
  await expect(attachmentsPreview).toBeVisible();
  await expect(attachmentsPreview).toContainText('diagram.png');

  await page.getByTestId('model-selector').click();
  const textOnlyOption = page.getByTestId(
    `model-selector-item-${TEXT_MODEL.id}`
  );
  await expect(textOnlyOption).toHaveAttribute(
    'title',
    'Remove attachments to select this model.'
  );
  await expect(textOnlyOption).toHaveAttribute('aria-disabled', 'true');

  await page.keyboard.press('Escape');

  await expect(page.getByTestId('model-selector')).toContainText(
    VISION_MODEL.name
  );
  await expect(attachmentsPreview).toBeVisible();

  const actionRequests = await page.evaluate(
    () => window.__testMocks?.actionRequests.length ?? 0
  );
  expect(actionRequests).toBe(0);
});
