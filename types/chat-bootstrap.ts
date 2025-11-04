import type { VisibilityType } from '@/components/visibility-selector';
import type { ChatModelOption } from '@/lib/ai/models';
import type { ChatSettings, DBMessage } from '@/lib/db/schema';
import type { AppUsage } from '@/lib/usage';
import type { AgentPreset } from '@/types/agent';
import type { SerializedChat } from '@/lib/cache/types';

interface ChatBootstrapCommon {
  chatId: string;
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  allowedModels: ChatModelOption[];
  initialSettings: ChatSettings | null;
  initialAgent: AgentPreset | null;
  shouldSetLastChatUrl: boolean;
}

export type NewChatBootstrap = ChatBootstrapCommon & {
  kind: 'new';
  autoResume: false;
  isReadonly: false;
  agentId?: undefined;
  initialMessages?: undefined;
  headMessageId?: undefined;
  initialLastContext?: undefined;
};

export type ExistingChatBootstrap = ChatBootstrapCommon & {
  kind: 'existing';
  autoResume: boolean;
  isReadonly: boolean;
  agentId?: string | null;
  initialMessages: DBMessage[];
  headMessageId: string | null;
  initialLastContext?: AppUsage | null;
  prefetchedChat?: SerializedChat;
};

export type ChatBootstrapResponse = NewChatBootstrap | ExistingChatBootstrap;
