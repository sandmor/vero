'use client';

import AgentPromptEditor from '@/components/agent-prompt-editor';
import { CreatorLogo } from '@/components/creator-logo';
import { toast } from '@/components/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAllowedModels } from '@/hooks/use-agents';
import {
  useResetSystemAgent,
  useUpdateSystemAgent,
} from '@/hooks/use-system-agents';
import { normalizeAgentPromptConfig } from '@/lib/agent-prompt';
import { displayCreatorName } from '@/lib/ai/creators';
import {
  DEFAULT_CHAT_SYSTEM_AGENT_SLUG,
  SYSTEM_AGENTS,
  type SystemAgentSettings,
} from '@/lib/ai/system-agents';
import type { SystemAgent } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

type FeedbackState = 'idle' | 'saved' | 'error';

function serializeSettingsSnapshot(settings: SystemAgentSettings): string {
  return JSON.stringify({
    modelId: settings.modelId,
    prompt: settings.prompt,
  });
}

function parseSystemAgentSettings(raw: unknown): SystemAgentSettings {
  if (!raw || typeof raw !== 'object') {
    return { modelId: undefined, prompt: normalizeAgentPromptConfig(null) };
  }
  const obj = raw as Record<string, unknown>;
  return {
    modelId: typeof obj.modelId === 'string' ? obj.modelId : undefined,
    prompt: normalizeAgentPromptConfig(obj.prompt),
  };
}

interface SystemAgentRowProps {
  agent: SystemAgent;
}

function SystemAgentRow({ agent }: SystemAgentRowProps) {
  const router = useRouter();
  const updateAgent = useUpdateSystemAgent();
  const resetAgent = useResetSystemAgent();
  const { data: modelsData, isLoading: isModelsLoading } = useAllowedModels();

  const definition = SYSTEM_AGENTS[agent.slug];
  const isDefaultChatAgent = agent.slug === DEFAULT_CHAT_SYSTEM_AGENT_SLUG;
  const allowedModels = modelsData?.models ?? [];

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    return allowedModels.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }, [allowedModels]);

  const hasDuplicateModelNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of allowedModels) {
      counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    }
    return Array.from(counts.values()).some((v) => v > 1);
  }, [allowedModels]);

  const initialSettings = useMemo((): SystemAgentSettings => {
    return parseSystemAgentSettings(agent.settings);
  }, [agent.settings]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SystemAgentSettings>(initialSettings);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>('idle');
  const feedbackTimer = useRef<number | null>(null);

  // Reset form when agent changes (e.g., after reset)
  useEffect(() => {
    setForm(parseSystemAgentSettings(agent.settings));
  }, [agent.settings]);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) {
        window.clearTimeout(feedbackTimer.current);
      }
    };
  }, []);

  const setFeedbackState = (state: FeedbackState, ttl = 1600) => {
    setFeedback(state);
    if (state === 'idle') return;
    if (feedbackTimer.current) {
      window.clearTimeout(feedbackTimer.current);
    }
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback('idle');
      feedbackTimer.current = null;
    }, ttl);
  };

  const initialSnapshot = useMemo(
    () => serializeSettingsSnapshot(initialSettings),
    [initialSettings]
  );
  const currentSnapshot = serializeSettingsSnapshot(form);
  const isDirty = currentSnapshot !== initialSnapshot;

  const selectedModelId = form.modelId ?? '__DEFAULT__';
  const promptConfig = normalizeAgentPromptConfig(form.prompt);
  const activeBlocks = promptConfig.blocks.filter(
    (block) => block.enabled && block.template.trim().length > 0
  );

  const handleSave = async () => {
    try {
      await updateAgent.mutateAsync({
        slug: agent.slug,
        settings: form,
      });
      toast({
        type: 'success',
        description: `${agent.name} updated`,
      });
      setFeedbackState('saved');
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to update system agent';
      toast({
        type: 'error',
        description: message,
      });
      setFeedbackState('error', 2200);
    }
  };

  const handleReset = async () => {
    try {
      const result = await resetAgent.mutateAsync(agent.slug);
      const newSettings = parseSystemAgentSettings(result.agent.settings);
      setForm(newSettings);
      toast({
        type: 'success',
        description: `${agent.name} reset to defaults`,
      });
      setShowResetDialog(false);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reset system agent';
      toast({
        type: 'error',
        description: message,
      });
    }
  };

  return (
    <TooltipProvider>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="rounded-lg border border-border/50 bg-card/30">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Bot className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{agent.name}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {agent.slug}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {agent.description || definition?.description}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{form.modelId || 'Default model'}</span>
                  <span>·</span>
                  <span>
                    {activeBlocks.length} block
                    {activeBlocks.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    open && 'rotate-180'
                  )}
                />
              </div>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="border-t border-border/50 p-4 space-y-6">
              {/* Model Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Model</h4>
                  <span className="text-xs text-muted-foreground">
                    Updated{' '}
                    {formatDistanceToNow(new Date(agent.updatedAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                {isModelsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading models…
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    <Button
                      type="button"
                      variant={
                        selectedModelId === '__DEFAULT__'
                          ? 'default'
                          : 'outline'
                      }
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({ ...prev, modelId: undefined }))
                      }
                      className="w-full justify-center"
                    >
                      <span className="truncate">Workspace default</span>
                    </Button>
                    {modelOptions.map((model) => (
                      <Button
                        key={model.id}
                        type="button"
                        variant={
                          selectedModelId === model.id ? 'default' : 'outline'
                        }
                        size="sm"
                        onClick={() =>
                          setForm((prev) => ({ ...prev, modelId: model.id }))
                        }
                        className="w-full justify-center"
                      >
                        <div className="flex w-full items-center gap-1.5">
                          {hasDuplicateModelNames && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex shrink-0">
                                  <CreatorLogo
                                    creatorSlug={model.creator}
                                    size={14}
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {displayCreatorName(model.creator)}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <span className="flex-1 truncate text-center">
                            {model.name}
                          </span>
                          {model.isBYOK && (
                            <Badge
                              variant="outline"
                              className="text-[9px] uppercase shrink-0"
                            >
                              BYOK
                            </Badge>
                          )}
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {/* Prompt Configuration */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Prompt Configuration</h4>
                <AgentPromptEditor
                  value={form.prompt}
                  onChange={(prompt) =>
                    setForm((prev) => ({ ...prev, prompt }))
                  }
                />
                {isDefaultChatAgent ? (
                  <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground">Available special variables</p>
                    <p className="mt-1">
                      User preferences: <code>{'{{user.name}}'}</code>,{' '}
                      <code>{'{{user.occupation}}'}</code>,{' '}
                      <code>{'{{user.customInstructions}}'}</code>.
                      Tool availability: <code>{'{{tools.runCode}}'}</code>,{' '}
                      <code>{'{{tools.archive}}'}</code>. Pinned memory: <code>{'{{pinnedEntriesBlock}}'}</code>.
                    </p>
                  </div>
                ) : null}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-border/30">
                <AlertDialog
                  open={showResetDialog}
                  onOpenChange={setShowResetDialog}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResetDialog(true)}
                    disabled={resetAgent.isPending}
                  >
                    {resetAgent.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="mr-2 h-4 w-4" />
                    )}
                    Reset to defaults
                  </Button>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset System Agent</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will reset &ldquo;{agent.name}&rdquo; to its
                        default settings. Any customizations will be lost.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleReset}>
                        Reset
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={updateAgent.isPending || !isDirty}
                >
                  <AnimatePresence mode="wait">
                    {updateAgent.isPending ? (
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-2"
                      >
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving
                      </motion.div>
                    ) : feedback === 'saved' ? (
                      <motion.div
                        key="saved"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-2"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Saved
                      </motion.div>
                    ) : feedback === 'error' ? (
                      <motion.div
                        key="error"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-2"
                      >
                        <CircleAlert className="h-4 w-4" />
                        Error
                      </motion.div>
                    ) : (
                      <motion.div
                        key="save"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        Save changes
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </TooltipProvider>
  );
}

export function SystemAgentsEditor({
  initialAgents,
}: {
  initialAgents: SystemAgent[];
}) {
  if (initialAgents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/10 p-8 text-center">
        <Bot className="h-8 w-8 text-muted-foreground" />
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">No system agents</h3>
          <p className="text-sm text-muted-foreground">
            System agents will appear here once initialized.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {initialAgents.map((agent) => (
        <SystemAgentRow key={agent.id} agent={agent} />
      ))}
    </div>
  );
}

export default SystemAgentsEditor;
