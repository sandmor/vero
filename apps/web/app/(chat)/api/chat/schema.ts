import { z } from 'zod';
import { getSettings } from '@/lib/settings';

const filePartSchema = z.object({
  type: z.enum(['file']),
  mediaType: z.enum(['image/jpeg', 'image/png']),
  name: z.string().min(1).max(100),
  url: z.url(),
});

export async function createPostRequestBodySchema() {
  const { maxMessageLength: maxLength } = await getSettings();
  const textPartSchema = z.object({
    type: z.enum(['text']),
    text: z.string().min(1).max(maxLength),
  });
  const partSchema = z.union([textPartSchema, filePartSchema]);

  return z.object({
    id: z.string().uuid(),
    message: z.object({
      id: z.string().uuid(),
      role: z.enum(['user']),
      parts: z.array(partSchema),
    }),
    regenerateMessageId: z.string().uuid().optional(),
    // Accept any composite provider:model id; entitlement check is enforced server-side.
    // Examples: 'google:gemini-2.5-pro', 'openrouter:google/gemini-2.5-flash'
    selectedChatModel: z
      .string()
      .min(3)
      .max(200)
      .refine((v) => v.includes(':'), {
        message:
          "selectedChatModel must be a composite id of the form 'provider:model'",
      }),
    selectedVisibilityType: z.enum(['public', 'private']),
    // Optional list of archive entry slugs to include immediately (will also be persisted if chat is new).
    // These are additive to whatever is already pinned in the database.
    pinnedSlugs: z
      .array(
        z
          .string()
          .min(1)
          .max(128)
          .regex(/^[a-zA-Z0-9._:-]+$/, {
            message: 'Slug contains invalid characters',
          })
      )
      .max(12)
      .optional(),
    // Optional allow list of tool ids.
    // Semantics: omitted (undefined) => ALL tools allowed (no restriction stored)
    //            [] => NO tools (explicit empty allow list)
    //            ['toolA', 'toolB'] => only those tools
    allowedTools: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-zA-Z0-9_-]+$/, {
            message: 'Tool id contains invalid characters',
          })
      )
      .max(32)
      .optional(),
    agentId: z.string().uuid().optional(),
    // Optional reasoning effort level (low, medium, high)
    // Controls how much computational effort the model uses for reasoning
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  });
}

export type PostRequestBody = z.infer<
  Awaited<ReturnType<typeof createPostRequestBodySchema>>
>;
