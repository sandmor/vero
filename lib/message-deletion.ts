export const MESSAGE_DELETION_MODES = [
  'version',
  'message-with-following',
  'message-only',
] as const;

export type MessageDeletionMode = (typeof MESSAGE_DELETION_MODES)[number];

export function isMessageDeletionMode(
  value: unknown
): value is MessageDeletionMode {
  return (
    typeof value === 'string' &&
    (MESSAGE_DELETION_MODES as readonly string[]).includes(value)
  );
}
