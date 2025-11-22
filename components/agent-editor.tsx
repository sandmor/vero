'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { CheckCircle2, ChevronLeft, Loader2, Trash2 } from 'lucide-react';
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
import { displayProviderName } from '@/lib/ai/registry';
import { LogoOpenAI, LogoGoogle, LogoOpenRouter } from '@/components/icons';
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
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
} from '@/hooks/use-agents';

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

export interface AgentEditorAgent {
  id: string;
  name: string;
  description: string | null;
  settings: ChatSettings | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentEditorProps {
  mode: 'create' | 'edit';
  agent?: AgentEditorAgent;
  allowedModels: ChatModelOption[];
}

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

export default function AgentEditor({
  mode,
  agent,
  allowedModels,
}: AgentEditorProps) {
  const router = useRouter();
  const createAgent = useCreateAgent();
  const updateAgent = useUpdateAgent();
  const deleteAgent = useDeleteAgent();

  const modelOptions = useMemo(() => {
    const seen = new Set<string>();
    return allowedModels.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  }, [allowedModels]);

  // detect whether there are any duplicate display names among allowedModels
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
        agentSettingsFromChatSettings(agent.settings)
      );
    }
    return cloneAgentSettingsValue(DEFAULT_AGENT_SETTINGS);
  }, [agent]);

  const [form, setForm] = useState<AgentFormState>(() => ({
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    settings: initialSettings,
  }));
  const [pinnedInput, setPinnedInput] = useState('');

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

  const formattedUpdatedAt = agent
    ? formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })
    : null;

  const isSaving = createAgent.isPending || updateAgent.isPending;
  const isDeleting = deleteAgent.isPending;
  const [saveFeedback, setSaveFeedback] = useFeedbackState();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
        router.replace(`/settings/agents/${response.agent.id}`);
        setSaveFeedback('success', 1600);
      } else if (agent) {
        const payload = agentSettingsToChatSettings(form.settings);
        await updateAgent.mutateAsync({
          id: agent.id,
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
    if (!agent || isDeleting) return;
    try {
      await deleteAgent.mutateAsync(agent.id);
      toast.success('Agent deleted');
      router.replace('/settings?tab=agents');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete agent';
      toast.error(message);
    }
  };

  const selectedModelId = form.settings.modelId ?? '__DEFAULT__';
  const allowedTools = form.settings.allowedTools;
  const allToolsSelected = allowedTools === undefined;

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <motion.div whileTap={{ scale: 0.95 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => router.push('/settings?tab=agents')}
                  className="px-2"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Agents overview
                </Button>
              </motion.div>
              {mode === 'edit' && !isDirty && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Up to date
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-semibold">
              {mode === 'create'
                ? 'Create agent'
                : (agent?.name ?? 'Untitled agent')}
            </h1>
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

        <Card>
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
                placeholder="Summarize this agent’s purpose"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
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
                                {model.provider === 'openai' ? (
                                  <LogoOpenAI size={16} />
                                ) : model.provider === 'google' ? (
                                  <LogoGoogle size={16} />
                                ) : (
                                  <LogoOpenRouter size={16} />
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {displayProviderName(model.provider)}
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
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
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

        <Card>
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
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
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

        <Card>
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

        <Card>
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
      </div>
    </TooltipProvider>
  );
}
