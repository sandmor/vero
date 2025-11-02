import type { Agent, Chat } from '@/lib/db/schema';
import type { SerializedAgent, SerializedChat } from '@/lib/cache/types';

export function serializeAgent(agent: Chat['agent']): SerializedAgent {
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    settings: agent.settings,
    userId: agent.userId,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export function serializeChat(chat: Chat): SerializedChat {
  const { agent, createdAt, ...rest } = chat;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    agent: serializeAgent(agent),
  } as SerializedChat;
}

export function deserializeAgent(serialized: SerializedAgent): Agent | null {
  if (!serialized) return null;
  return {
    id: serialized.id,
    name: serialized.name,
    description: serialized.description,
    settings: serialized.settings as Agent['settings'],
    userId: serialized.userId,
    createdAt: new Date(serialized.createdAt),
    updatedAt: new Date(serialized.updatedAt),
  } as Agent;
}

export function deserializeChat(snapshot: SerializedChat): Chat {
  const { agent, createdAt, ...rest } = snapshot;
  return {
    ...rest,
    createdAt: new Date(createdAt),
    agent: deserializeAgent(agent),
  } as Chat;
}
