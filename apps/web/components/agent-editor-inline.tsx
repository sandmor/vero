'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import {
  agentSettingsFromChatSettings,
  agentSettingsIsDefault,
  agentSettingsToChatSettings,
  cloneAgentSettingsValue,
  DEFAULT_AGENT_SETTINGS,
} from '@/lib/agent-settings';
import type { ChatSettings } from '@/lib/db/schema';
import type { ChatModelOption } from '@/lib/ai/models';
import { CHAT_TOOL_IDS, type ChatToolId } from '@/lib/ai/tool-ids';
import { cn } from '@/lib/utils';
import { displayCreatorName } from '@/lib/ai/creators';
import { CreatorLogo } from '@/components/creator-logo';
import { useFeedbackState } from '@/hooks/use-feedback-state';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
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
import AgentPromptEditor from '@/components/agent-prompt-editor';
import {
  useAgent,
  useAllowedModels,
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
} from '@/hooks/use-agents';
import { useSettingsStore } from '@/lib/stores/settings-store';

const REASONING_OPTIONS: Array<{
  value: 'low' | 'medium' | 'high';
  label: string;
  description: string;
}> = [
  {
    value: 'low',
    label: 'Low',
    description: 'Faster responses with light reasoning',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balanced latency and quality',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Deeper reasoning at higher cost and latency',
  },
];

interface AgentFormState {
  name: string;
  description: string;
  settings: ReturnType<typeof cloneAgentSettingsValue>;
}

const TOOL_LABELS: Record<ChatToolId, string> = {
  getWeather: 'Weather',
  runCode: 'Run Code',
  readArchive: 'Read Archive',
  writeArchive: 'Write Archive',
  manageChatPins: 'Manage Chat Pins',
};

function serializeSettingsSnapshot(state: AgentFormState) {
  return JSON.stringify({
    name: state.name.trim(),
    description: state.description.trim(),
    settings: agentSettingsToChatSettings(state.settings),
  });
}

interface AgentEditorInlineProps {
  mode: 'create' | 'edit';
  agentId?: string;
}

export function AgentEditorInline({ mode, agentId }: AgentEditorInlineProps) {
  const { setAgentView, setEditingAgent } = useSettingsStore();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  // Fetch agent data for edit mode
  const { data: agentData, isLoading: isAgentLoading } = useAgent(
    mode === 'edit' ? agentId : undefined
  );
  const agent = agentData?.agent;

  // Fetch allowed models
  const { data: modelsData, isLoading: isModelsLoading } = useAllowedModels();
  const allowedModels = modelsData?.models ?? [];

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    return allowedModels.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }, [allowedModels]);

  // Detect duplicate display names
  const hasDuplicateModelNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of allowedModels) {
      counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    }
    return Array.from(counts.values()).some((v) => v > 1);
  }, [allowedModels]);

  const initialSettings = useMemo(() => {
    if (agent) {
      return cloneAgentSettingsValue(
        agentSettingsFromChatSettings(agent.settings as ChatSettings | null)
      );
    }
    return cloneAgentSettingsValue(DEFAULT_AGENT_SETTINGS);
  }, [agent]);

  const [form, setForm] = useState<AgentFormState>(() => ({
    name: '',
    description: '',
    settings: cloneAgentSettingsValue(DEFAULT_AGENT_SETTINGS),
  }));
  const [pinnedInput, setPinnedInput] = useState('');
  const [formInitialized, setFormInitialized] = useState(false);

  // Initialize form when agent data loads
  useMemo(() => {
    if (mode === 'edit' && agent && !formInitialized) {
      setForm({
        name: agent.name ?? '',
        description: agent.description ?? '',
        settings: initialSettings,
      });
      setFormInitialized(true);
    } else if (mode === 'create' && !formInitialized) {
      setFormInitialized(true);
    }
  }, [agent, mode, initialSettings, formInitialized]);

  const initialSnapshot = useMemo(
    () =>
      serializeSettingsSnapshot({
        name: agent?.name ?? '',
        description: agent?.description ?? '',
        settings: initialSettings,
      }),
    [agent?.description, agent?.name, initialSettings]
  );

  const currentSnapshot = serializeSettingsSnapshot(form);
  const isDirty = currentSnapshot !== initialSnapshot;

  const formattedUpdatedAt = agent?.updatedAt
    ? formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })
    : null;

  const isSaving = createAgent.isPending || updateAgent.isPending;
  const isDeleting = deleteAgent.isPending;
  const [saveFeedback, setSaveFeedback] = useFeedbackState();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleBack = () => {
    setAgentView('list');
  };

  const toggleTool = (tool: ChatToolId) => {
    setForm((prev) => {
      const current = prev.settings.allowedTools;
      const nextAllowed = current ? [...current] : [];
      if (!current) {
        return {
          ...prev,
          settings: {
            ...prev.settings,
            allowedTools: [tool],
          },
        };
      }
      const idx = nextAllowed.indexOf(tool);
      if (idx >= 0) {
        nextAllowed.splice(idx, 1);
      } else {
        nextAllowed.push(tool);
      }
      return {
        ...prev,
        settings: {
          ...prev.settings,
          allowedTools: nextAllowed.length ? nextAllowed : [],
        },
      };
    });
  };

  const setAllowAllTools = (allowAll: boolean) => {
    setForm((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        allowedTools: allowAll ? undefined : [],
      },
    }));
  };

  const handleToolChoiceKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    tool: ChatToolId
  ) => {
    if (
      event.key === ' ' ||
      event.key === 'Spacebar' ||
      event.key === 'Enter'
    ) {
      event.preventDefault();
      toggleTool(tool);
    }
  };

  const addPinnedEntry = () => {
    const slug = pinnedInput.trim().toLowerCase();
    if (!slug) return;
    setForm((prev) => {
      if (prev.settings.pinnedEntries.includes(slug)) return prev;
      if (prev.settings.pinnedEntries.length >= 12) {
        toast.error('Maximum of 12 pinned entries per agent');
        return prev;
      }
      return {
        ...prev,
        settings: {
          ...prev.settings,
          pinnedEntries: [...prev.settings.pinnedEntries, slug],
        },
      };
    });
    setPinnedInput('');
  };

  const removePinnedEntry = (slug: string) => {
    setForm((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        pinnedEntries: prev.settings.pinnedEntries.filter(
          (item) => item !== slug
        ),
      },
    }));
  };

  const handleSave = async () => {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      toast.error('Agent name is required');
      return;
    }
    setSaveFeedback('loading');
    try {
      if (mode === 'create') {
        const payload = agentSettingsToChatSettings(form.settings);
        const response = await createAgent.mutateAsync({
          name: trimmedName,
          description: form.description.trim() || undefined,
          settings: agentSettingsIsDefault(form.settings) ? undefined : payload,
        });
        toast.success('Agent created');
        // Switch to edit mode with the new agent
        setEditingAgent(response.agent.id);
        setSaveFeedback('success', 1600);
      } else if (agentId) {
        const payload = agentSettingsToChatSettings(form.settings);
        await updateAgent.mutateAsync({
          id: agentId,
          data: {
            name: trimmedName,
            description: form.description.trim() || undefined,
            settings: payload,
          },
        });
        toast.success('Agent updated');
        setSaveFeedback('success', 1600);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save agent';
      toast.error(message);
      setSaveFeedback('error', 2200);
    }
  };

  const handleDelete = async () => {
    if (!agentId || isDeleting) return;
    try {
      await deleteAgent.mutateAsync(agentId);
      toast.success('Agent deleted');
      setAgentView('list');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete agent';
      toast.error(message);
    }
  };

  const selectedModelId = form.settings.modelId ?? '__DEFAULT__';
  const allowedTools = form.settings.allowedTools;
  const allToolsSelected = allowedTools === undefined;

  // Loading state
  if ((mode === 'edit' && isAgentLoading) || isModelsLoading) {
    return (
      <div className="space-y-6 animate-in fade-in-0">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-6 w-24" />
        </div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // Agent not found
  if (mode === 'edit' && !agent && !isAgentLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <p className="text-muted-foreground">Agent not found.</p>
        <Button variant="outline" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to agents
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col gap-6"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <motion.div whileTap={{ scale: 0.95 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleBack}
                  className="px-2"
                >
                  <ArrowLeft className="mr-1 h-4 w-4" /> Back to agents
                </Button>
              </motion.div>
              {mode === 'edit' && !isDirty && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Up to date
                </Badge>
              )}
            </div>
            <h2 className="text-xl font-semibold">
              {mode === 'create'
                ? 'Create agent'
                : (agent?.name ?? 'Untitled agent')}
            </h2>
            <p className="text-sm text-muted-foreground">
              Configure defaults, allowed tools, and prompt blocks for this
              agent.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'edit' && (
              <AlertDialog
                open={showDeleteDialog}
                onOpenChange={setShowDeleteDialog}
              >
                <AlertDialogTrigger asChild>
                  <motion.div whileTap={{ scale: 0.95 }}>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Delete
                    </Button>
                  </motion.div>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Agent</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete &ldquo;{agent?.name}
                      &rdquo;? This action cannot be undone.
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
            )}
            <motion.div whileTap={{ scale: 0.95 }}>
              <Button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !form.name.trim()}
                className="relative"
              >
                <AnimatedButtonLabel
                  state={saveFeedback}
                  idleLabel={
                    mode === 'create' ? 'Create agent' : 'Save changes'
                  }
                  loadingLabel={mode === 'create' ? 'Creating…' : 'Saving…'}
                  successLabel="Saved"
                  errorLabel="Error"
                />
              </Button>
            </motion.div>
          </div>
        </div>

        {mode === 'edit' && formattedUpdatedAt && (
          <p className="text-xs text-muted-foreground">
            Last updated {formattedUpdatedAt}
          </p>
        )}

        {/* Basics Card */}
        <Card className="border-border/40 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Basics</CardTitle>
            <CardDescription>
              Provide a recognizable name and optional description for this
              agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="agent-name">
                Agent name
              </label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Research assistant"
              />
            </div>
            <div className="space-y-1">
              <label
                className="text-sm font-medium"
                htmlFor="agent-description"
              >
                Description
              </label>
              <Textarea
                id="agent-description"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                rows={3}
                placeholder="Summarize this agent's purpose"
              />
            </div>
          </CardContent>
        </Card>

        {/* Model & Reasoning Card */}
        <Card className="border-border/40 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Model & reasoning defaults</CardTitle>
            <CardDescription>
              Set optional overrides for the model and reasoning effort used
              when this agent starts a chat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="agent-model">
                Preferred model
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <motion.div whileTap={{ scale: 0.95 }}>
                  <Button
                    type="button"
                    variant={
                      selectedModelId === '__DEFAULT__' ? 'default' : 'outline'
                    }
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        settings: { ...prev.settings, modelId: undefined },
                      }))
                    }
                    className="w-full justify-center"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="w-4" aria-hidden />
                      <span className="flex-1 text-center truncate">
                        Workspace default
                      </span>
                    </div>
                  </Button>
                </motion.div>
                {modelOptions.map((model) => (
                  <motion.div key={model.id} whileTap={{ scale: 0.95 }}>
                    <Button
                      type="button"
                      variant={
                        selectedModelId === model.id ? 'default' : 'outline'
                      }
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, modelId: model.id },
                        }))
                      }
                      className="w-full justify-center"
                    >
                      <div className="flex w-full items-center gap-2">
                        {hasDuplicateModelNames ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="flex w-4 justify-center"
                                aria-hidden={false}
                              >
                                <CreatorLogo
                                  creatorSlug={model.creator}
                                  size={16}
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {displayCreatorName(model.creator)}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="w-4" aria-hidden />
                        )}

                        <span className={cn('flex-1 truncate text-center')}>
                          {model.name}
                        </span>
                        {model.isBYOK && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase tracking-wide"
                          >
                            BYOK
                          </Badge>
                        )}
                      </div>
                    </Button>
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reasoning effort</label>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                <Button
                  type="button"
                  variant={
                    form.settings.reasoningEffort ? 'outline' : 'default'
                  }
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      settings: {
                        ...prev.settings,
                        reasoningEffort: undefined,
                      },
                    }))
                  }
                  className="justify-center"
                >
                  <span className="truncate">Workspace default</span>
                </Button>
                {REASONING_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={
                      form.settings.reasoningEffort === option.value
                        ? 'default'
                        : 'outline'
                    }
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          reasoningEffort: option.value,
                        },
                      }))
                    }
                    className="justify-center"
                  >
                    <span className="truncate">{option.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Allowed Tools Card */}
        <Card className="border-border/40 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Allowed tools</CardTitle>
            <CardDescription>
              Restrict which tools this agent can invoke by default. Leave to
              allow all tools supported by the selected model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="agent-tools-all"
                checked={allToolsSelected}
                onCheckedChange={(checked) =>
                  setAllowAllTools(Boolean(checked))
                }
              />
              <label htmlFor="agent-tools-all" className="text-sm">
                Allow all tools
              </label>
            </div>
            {!allToolsSelected && (
              <div className="grid gap-3 sm:grid-cols-2">
                {CHAT_TOOL_IDS.map((tool) => {
                  const selected = allowedTools?.includes(tool) ?? false;
                  return (
                    <div
                      key={tool}
                      role="checkbox"
                      tabIndex={0}
                      aria-checked={selected}
                      onClick={() => toggleTool(tool)}
                      onKeyDown={(event) =>
                        handleToolChoiceKeyDown(event, tool)
                      }
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background cursor-pointer',
                        selected
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/40'
                      )}
                    >
                      <span>{TOOL_LABELS[tool]}</span>
                      <Checkbox
                        checked={selected}
                        className="pointer-events-none"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pinned Memory Card */}
        <Card className="border-border/40 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Pinned memory</CardTitle>
            <CardDescription>
              Provide archive entry slugs that should auto-pin whenever a chat
              is started with this agent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {form.settings.pinnedEntries.map((slug) => (
                <Badge key={slug} variant="secondary" className="gap-2">
                  {slug}
                  <button
                    type="button"
                    onClick={() => removePinnedEntry(slug)}
                    className="text-muted-foreground transition hover:text-foreground"
                  >
                    ×
                  </button>
                </Badge>
              ))}
              {form.settings.pinnedEntries.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  No pinned entries yet.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={pinnedInput}
                onChange={(event) => setPinnedInput(event.target.value)}
                placeholder="archive-entry-slug"
                className="sm:flex-1"
              />
              <motion.div whileTap={{ scale: 0.95 }}>
                <Button type="button" onClick={addPinnedEntry}>
                  Add
                </Button>
              </motion.div>
            </div>
            <p className="text-xs text-muted-foreground">
              Slugs must match existing archive entries. Maximum of 12 pinned
              per agent.
            </p>
          </CardContent>
        </Card>

        {/* Advanced Prompt Card */}
        <Card className="border-border/40 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Advanced prompt</CardTitle>
            <CardDescription>
              Compose structured prompt blocks and reusable variables. These
              values become the system prompt foundation whenever this agent is
              used.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AgentPromptEditor
              value={form.settings.prompt}
              onChange={(prompt) =>
                setForm((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, prompt },
                }))
              }
            />
          </CardContent>
        </Card>
      </motion.div>
    </TooltipProvider>
  );
}

export default AgentEditorInline;
