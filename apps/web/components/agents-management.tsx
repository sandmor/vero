'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  Blocks,
  Loader2,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAgents, useDeleteAgent } from '@/hooks/use-agents';
import {
  agentSettingsFromChatSettings,
  type AgentSettingsValue,
} from '@/lib/agent-settings';
import type { ChatSettings } from '@/lib/db/schema';
import { normalizeAgentPromptConfig } from '@/lib/agent-prompt';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function buildSettingsSummary(settings: AgentSettingsValue) {
  const allowedTools = settings.allowedTools;
  const toolSummary =
    allowedTools === undefined
      ? 'All tools'
      : allowedTools.length === 0
        ? 'No tools'
        : `${allowedTools.length} tool${allowedTools.length === 1 ? '' : 's'}`;

  const pinnedCount = settings.pinnedEntries.length;
  const pinnedSummary =
    pinnedCount === 0
      ? 'No pinned memory'
      : `${pinnedCount} pinned entr${pinnedCount === 1 ? 'y' : 'ies'}`;

  const promptConfig = normalizeAgentPromptConfig(settings.prompt);
  const activeBlocks = promptConfig.blocks.filter(
    (block) => block.enabled && block.template.trim().length > 0
  );
  const variableCount = promptConfig.variables.length;

  return {
    toolSummary,
    pinnedSummary,
    promptSummary:
      activeBlocks.length === 0 && variableCount === 0
        ? 'Inherits workspace system prompt'
        : `${activeBlocks.length} block${activeBlocks.length === 1 ? '' : 's'} · ${variableCount} variable${variableCount === 1 ? '' : 's'}`,
    promptHasCustom: activeBlocks.length > 0 || variableCount > 0,
    promptMode: promptConfig.mode,
  };
}

export function AgentsManagement() {
  const router = useRouter();
  const { data, error, isLoading, isFetching, refetch } = useAgents();
  const deleteAgent = useDeleteAgent();

  const agents = data?.agents ?? [];
  const [deleteDialogState, setDeleteDialogState] = useState<{
    isOpen: boolean;
    agentId: string | null;
    agentName: string | null;
  }>({ isOpen: false, agentId: null, agentName: null });

  const handleCreate = () => {
    router.push('/settings/agents/new');
  };

  const handleDelete = async () => {
    if (!deleteDialogState.agentId || deleteAgent.isPending) return;
    try {
      await deleteAgent.mutateAsync(deleteDialogState.agentId);
      toast.success('Agent deleted');
      setDeleteDialogState({ isOpen: false, agentId: null, agentName: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to delete agent';
      toast.error(message);
    }
  };

  const openDeleteDialog = (id: string, name: string) => {
    setDeleteDialogState({ isOpen: true, agentId: id, agentName: name });
  };

  let content;
  if (isLoading) {
    content = (
      <div className="grid grid-cols-1 gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="border-dashed">
            <CardHeader>
              <div className="h-5 w-32 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-4 w-48 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  } else if (error) {
    content = (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-6 text-center">
        <p className="text-sm font-medium text-destructive">
          Failed to load agents.
        </p>
        <motion.div whileTap={{ scale: 0.95 }}>
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </motion.div>
      </div>
    );
  } else if (agents.length === 0) {
    content = (
      <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/10 p-8 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">No agents yet</h3>
          <p className="text-sm text-muted-foreground">
            Create an agent to define advanced behavior, custom prompts, and
            chat presets for your workspace.
          </p>
        </div>
        <motion.div whileTap={{ scale: 0.95 }}>
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" /> Create agent
          </Button>
        </motion.div>
      </div>
    );
  } else {
    content = (
      <motion.div
        layout
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {agents.map((agent) => {
          const settings = agentSettingsFromChatSettings(
            agent.settings as ChatSettings | null | undefined
          );
          const summary = buildSettingsSummary(settings);
          const updatedLabel = formatDistanceToNow(new Date(agent.updatedAt), {
            addSuffix: true,
          });

          return (
            <motion.div layout key={agent.id}>
              <Card className="flex h-full flex-col border-border/70 bg-card/80 backdrop-blur">
                <CardHeader className="space-y-1">
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span className="truncate text-base font-semibold">
                      {agent.name}
                    </span>
                    {summary.promptHasCustom ? (
                      <Badge
                        variant="secondary"
                        className="flex items-center gap-1"
                      >
                        <Sparkles className="h-3 w-3" /> Custom prompt
                      </Badge>
                    ) : (
                      <Badge variant="outline">Preset</Badge>
                    )}
                  </CardTitle>
                  {agent.description ? (
                    <CardDescription className="line-clamp-2 text-sm">
                      {agent.description}
                    </CardDescription>
                  ) : (
                    <CardDescription className="text-xs text-muted-foreground">
                      No description provided.
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex-1 space-y-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Updated {updatedLabel}</span>
                    <span className="capitalize">
                      Mode: {summary.promptMode}
                    </span>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Blocks className="h-4 w-4 text-muted-foreground" />
                      <span>{summary.promptSummary}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Tools:
                      </span>
                      <span>{summary.toolSummary}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Pinned:
                      </span>
                      <span>{summary.pinnedSummary}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between">
                  <motion.div whileTap={{ scale: 0.95 }}>
                    <Button variant="outline" asChild>
                      <Link href={`/settings/agents/${agent.id}`}>Open</Link>
                    </Button>
                  </motion.div>
                  <motion.div whileTap={{ scale: 0.95 }}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDeleteDialog(agent.id, agent.name)}
                      disabled={deleteAgent.isPending}
                    >
                      {deleteAgent.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span className="sr-only">Delete agent</span>
                    </Button>
                  </motion.div>
                </CardFooter>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between px-6 pt-4 pb-3">
        <div>
          <h2 className="text-lg font-semibold">Agents overview</h2>
          <p className="text-sm text-muted-foreground">
            Agents bundle preferred models, tools, pinned memories, and custom
            prompts into reusable chat presets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <motion.div whileTap={{ scale: 0.95 }}>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              <span className="sr-only">Refresh agents</span>
            </Button>
          </motion.div>
          <motion.div whileTap={{ scale: 0.95 }}>
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" /> New agent
            </Button>
          </motion.div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">{content}</div>

      <AlertDialog
        open={deleteDialogState.isOpen}
        onOpenChange={(open) =>
          setDeleteDialogState((prev) => ({ ...prev, isOpen: open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;
              {deleteDialogState.agentName}&rdquo;? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AgentsManagement;
