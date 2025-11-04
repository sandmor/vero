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
    pathText: '_00',
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
    pathText: '_00._00',
    parentPath: '_00',
    depth: 1,
    siblingsCount: 1,
    siblingIndex: 0,
    children: [],
  };

  userMessage.children = [assistantMessage];

  await openChat(page, {
    bootstrap: {
      kind: 'existing',
      initialMessages: [userMessage, assistantMessage],
      headMessageId: assistantMessage.id,
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

test('editing a user message replaces the timeline entry with edited content', async ({
  page,
}) => {
  const baseTime = new Date('2024-02-01T08:00:00Z');
  const originalUser: any = {
    id: 'msg-user-original',
    chatId: 'chat-e2e',
    role: 'user',
    parts: [{ type: 'text', text: 'Draft a project kickoff email.' }],
    attachments: [],
    createdAt: baseTime,
    updatedAt: baseTime,
    parentId: null,
    model: null,
    pathText: '_00',
    parentPath: null,
    depth: 0,
    siblingsCount: 1,
    siblingIndex: 0,
    children: [],
  };

  const assistantReply: any = {
    id: 'msg-assistant-followup',
    chatId: 'chat-e2e',
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: 'Here is a rough kickoff email outline.',
      },
    ],
    attachments: [],
    createdAt: new Date(baseTime.getTime() + 90_000),
    updatedAt: new Date(baseTime.getTime() + 90_000),
    parentId: 'msg-user-original',
    model: 'openrouter:text',
    pathText: '_00._00',
    parentPath: '_00',
    depth: 1,
    siblingsCount: 1,
    siblingIndex: 0,
    children: [],
  };

  originalUser.children = [assistantReply];

  await openChat(page, {
    bootstrap: {
      kind: 'existing',
      initialMessages: [originalUser, assistantReply],
      headMessageId: assistantReply.id,
    },
  });

  const targetUserMessage = page
    .locator('[data-testid="message-user"]')
    .filter({ hasText: 'Draft a project kickoff email.' })
    .first();
  await targetUserMessage.getByRole('button', { name: 'Edit' }).click();

  const editor = page.getByTestId('message-editor');
  await editor.fill('Could you prepare a kickoff call agenda instead?');
  await page.getByTestId('message-editor-send-button').click();

  const latestUserMessage = page.locator('[data-testid="message-user"]').last();
  await expect(latestUserMessage).toContainText(
    'Could you prepare a kickoff call agenda instead?'
  );
});
