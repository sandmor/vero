import { expect, test } from '@playwright/test';
import { openChat } from './chat-helpers';

test.describe.configure({ mode: 'serial' });

test('shows the greeting when the conversation is empty', async ({ page }) => {
  await openChat(page);
  await expect(page.getByText('How can I help you today?')).toBeVisible();
});

test('renders existing timeline content and shows thinking state for new messages', async ({
  page,
}) => {
  const baseTime = new Date('2024-01-01T00:00:00Z');
  const userMessage: any = {
    id: 'msg-user-existing',
    chatId: 'chat-e2e',
    role: 'user',
    parts: [{ type: 'text', text: 'Can you summarise the attached report?' }],
    attachments: [],
    createdAt: baseTime,
    updatedAt: baseTime,
    parentId: null,
    model: null,
    pathText: '0',
    parentPath: null,
    depth: 0,
    siblingsCount: 1,
    siblingIndex: 0,
    children: [],
  };

  const assistantMessage: any = {
    id: 'msg-assistant-existing',
    chatId: 'chat-e2e',
    role: 'assistant',
    parts: [
      {
        type: 'file',
        url: 'https://example.com/report.pdf',
        filename: 'report.pdf',
        mediaType: 'application/pdf',
      },
      {
        type: 'text',
        text: 'Here is the summary of the latest financial report.',
      },
    ],
    attachments: [],
    createdAt: new Date(baseTime.getTime() + 60_000),
    updatedAt: new Date(baseTime.getTime() + 60_000),
    parentId: 'msg-user-existing',
    model: 'openrouter:vision',
    pathText: '0.0',
    parentPath: '0',
    depth: 1,
    siblingsCount: 1,
    siblingIndex: 0,
    children: [],
  };

  userMessage.children = [assistantMessage];

  const initialMessageTree = {
    tree: [userMessage],
    nodes: [userMessage, assistantMessage],
    branch: [userMessage, assistantMessage],
  };

  await openChat(page, {
    bootstrap: {
      kind: 'existing',
      initialMessageTree,
    },
  });

  const userMessages = page.locator('[data-testid="message-user"]');
  await expect(userMessages.first()).toContainText(
    'Can you summarise the attached report?'
  );

  const assistantMessages = page.locator('[data-testid="message-assistant"]');
  await expect(assistantMessages.first()).toContainText(
    'Here is the summary of the latest financial report.'
  );

  const attachmentPreview = page.locator('[data-testid="message-attachments"]');
  await expect(attachmentPreview).toContainText('report.pdf');

  await page.getByTestId('multimodal-input').fill('Add a follow-up insight.');
  await page.getByTestId('send-button').click();

  await expect
    .poll(async () => {
      return page.evaluate(() => window.__testMocks?.chatRequests.length ?? 0);
    })
    .toBeGreaterThanOrEqual(1);

  await page.waitForSelector('[data-testid="message-assistant-loading"]', {
    state: 'attached',
    timeout: 10_000,
  });
  await expect(userMessages.last()).toContainText('Add a follow-up insight.');
});
