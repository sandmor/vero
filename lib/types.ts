import type { InferUITool, UIMessage } from 'ai';
import { z } from 'zod';
import type { ArtifactKind } from '@/components/artifact';
import type { createDocument } from './ai/tools/create-document';
import type { getWeather } from './ai/tools/get-weather';
import type { requestSuggestions } from './ai/tools/request-suggestions';
import type { updateDocument } from './ai/tools/update-document';
import type { readArchive } from './ai/tools/readArchive';
import type { writeArchive } from './ai/tools/writeArchive';
import type { manageChatPins } from './ai/tools/manageChatPins';
import type { runCode } from './ai/tools/run-code';
import type { Suggestion } from './db/schema';
import type { AppUsage } from './usage';

export type DataPart = { type: 'append-message'; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
  model: z.string().optional(),
  siblingIndex: z.number(),
  siblingsCount: z.number(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type readArchiveTool = InferUITool<ReturnType<typeof readArchive>>;
type writeArchiveTool = InferUITool<ReturnType<typeof writeArchive>>;
type manageChatPinsTool = InferUITool<ReturnType<typeof manageChatPins>>;
type runCodeTool = InferUITool<ReturnType<typeof runCode>>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  readArchive: readArchiveTool;
  writeArchive: writeArchiveTool;
  manageChatPins: manageChatPinsTool;
  runCode: runCodeTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  codeLanguage: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  usage: AppUsage;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
