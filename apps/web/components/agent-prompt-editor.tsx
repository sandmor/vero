'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  cloneAgentPromptConfig,
  createEmptyPromptBlock,
  createEmptyPromptVariable,
  type AgentPromptBlock,
  type AgentPromptConfig,
} from '@/lib/agent-prompt';

interface AgentPromptEditorProps {
  value: AgentPromptConfig;
  onChange: (value: AgentPromptConfig) => void;
}

const MODE_LABELS: Record<AgentPromptConfig['mode'], string> = {
  append: 'Append to workspace defaults',
  replace: 'Replace workspace defaults',
};

const ROLE_LABELS: Record<AgentPromptBlock['role'], string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
};

export function AgentPromptEditor({ value, onChange }: AgentPromptEditorProps) {
  const updateConfig = useCallback(
    (mutate: (draft: AgentPromptConfig) => void) => {
      const draft = cloneAgentPromptConfig(value);
      mutate(draft);
      draft.blocks = draft.blocks.map((block, index) => ({
        ...block,
        order: index,
      }));
      onChange(draft);
    },
    [onChange, value]
  );

  const [rolledBlockIds, setRolledBlockIds] = useState<string[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  useEffect(() => {
    setRolledBlockIds((prev) =>
      prev.filter((id) => value.blocks.some((block) => block.id === id))
    );
  }, [value.blocks]);

  const toggleBlockRoll = useCallback((blockId: string) => {
    setRolledBlockIds((prev) =>
      prev.includes(blockId)
        ? prev.filter((id) => id !== blockId)
        : [...prev, blockId]
    );
  }, []);

  const handleModeChange = (mode: AgentPromptConfig['mode']) => {
    updateConfig((draft) => {
      draft.mode = mode;
    });
  };

  const handleJoinerChange = (joiner: string) => {
    updateConfig((draft) => {
      draft.joiner = joiner;
    });
  };

  const handleBlockUpdate = (
    index: number,
    patch: Partial<AgentPromptBlock>
  ) => {
    updateConfig((draft) => {
      const block = draft.blocks[index];
      if (!block) return;
      draft.blocks[index] = { ...block, ...patch };
    });
  };

  const handleAddBlock = () => {
    updateConfig((draft) => {
      const block = createEmptyPromptBlock();
      block.order = draft.blocks.length;
      draft.blocks.push(block);
    });
  };

  const handleRemoveBlock = (index: number) => {
    const blockId = value.blocks[index]?.id;
    updateConfig((draft) => {
      draft.blocks.splice(index, 1);
    });
    if (blockId) {
      setRolledBlockIds((prev) => prev.filter((id) => id !== blockId));
      setActiveBlockId((prev) => (prev === blockId ? null : prev));
    }
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    setActiveBlockId(String(active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = value.blocks.findIndex(
        (block) => block.id === active.id
      );
      const newIndex = value.blocks.findIndex((block) => block.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      updateConfig((draft) => {
        draft.blocks = arrayMove(draft.blocks, oldIndex, newIndex);
      });
      setActiveBlockId(null);
    },
    [updateConfig, value.blocks]
  );

  const handleDragCancel = useCallback(() => {
    setActiveBlockId(null);
  }, []);

  const handleAddVariable = () => {
    updateConfig((draft) => {
      draft.variables.push(createEmptyPromptVariable());
    });
  };

  const handleRemoveVariable = (index: number) => {
    updateConfig((draft) => {
      draft.variables.splice(index, 1);
    });
  };

  const handleVariableChange = (
    index: number,
    field: 'key' | 'label' | 'defaultValue' | 'description' | 'required',
    next: string | boolean
  ) => {
    updateConfig((draft) => {
      const variable = draft.variables[index];
      if (!variable) return;
      if (field === 'required') {
        variable.required = Boolean(next);
      } else if (field === 'key') {
        const sanitized = String(next)
          .replace(/[^a-zA-Z0-9_.-]/g, '')
          .slice(0, 64);
        variable.key = sanitized;
      } else if (field === 'defaultValue') {
        variable.defaultValue = String(next);
      } else if (field === 'label') {
        variable.label = String(next);
      } else if (field === 'description') {
        variable.description = String(next);
      }
    });
  };

  const activeBlock = activeBlockId
    ? (value.blocks.find((block) => block.id === activeBlockId) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Prompt behavior</h3>
          <p className="text-sm text-muted-foreground">
            Decide whether this agent appends to or replaces the default
            workspace prompt. Blocks render in order and can use variables.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['append', 'replace'] as AgentPromptConfig['mode'][]).map(
            (mode) => (
              <Button
                key={mode}
                type="button"
                variant={value.mode === mode ? 'default' : 'outline'}
                onClick={() => handleModeChange(mode)}
              >
                {MODE_LABELS[mode]}
              </Button>
            )
          )}
        </div>
        <div className="max-w-md space-y-1">
          <Label htmlFor="prompt-joiner">Block joiner</Label>
          <Input
            id="prompt-joiner"
            value={value.joiner}
            onChange={(event) => handleJoinerChange(event.target.value)}
            placeholder={'\n\n'}
          />
          <p className="text-xs text-muted-foreground">
            Inserted between prompt blocks when composing the final system
            prompt.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Prompt blocks</h3>
            <p className="text-sm text-muted-foreground">
              Blocks render sequentially. Use <code>{'{{variables.key}}'}</code>
              to reference variable values or{' '}
              <code>{'{{datetime "MMMM dd, yyyy hh:mm:ss"}}'}</code> to insert
              the current time.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={handleAddBlock}>
            <Plus className="mr-2 h-4 w-4" /> Add block
          </Button>
        </div>
        <div className="space-y-4">
          {value.blocks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 p-6 text-sm text-muted-foreground">
              No blocks defined. The agent will only use the workspace default
              prompt.
            </div>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext
                items={value.blocks.map((block) => block.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-4">
                  {value.blocks.map((block, index) => (
                    <SortablePromptBlockCard
                      key={block.id}
                      block={block}
                      index={index}
                      isRolled={rolledBlockIds.includes(block.id)}
                      isActive={activeBlockId === block.id}
                      onToggleRoll={() => toggleBlockRoll(block.id)}
                      onChange={(patch: Partial<AgentPromptBlock>) =>
                        handleBlockUpdate(index, patch)
                      }
                      onRemove={() => handleRemoveBlock(index)}
                    />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay
                dropAnimation={{ duration: 0.18, easing: 'ease-out' }}
              >
                {activeBlock ? (
                  <motion.div
                    className={cn(
                      'border-border/70 bg-background rounded-lg shadow-2xl ring-2 ring-primary/60 scale-105 opacity-95',
                      'p-4 min-w-[320px] max-w-lg'
                    )}
                    initial={{ scale: 1, opacity: 0.7 }}
                    animate={{ scale: 1.05, opacity: 0.95 }}
                    exit={{ scale: 0.98, opacity: 0.5 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold truncate">
                        {activeBlock.title || 'Block'}
                      </span>
                      {!activeBlock.enabled && (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {(activeBlock.template ?? '')
                        .replace(/\s+/g, ' ')
                        .slice(0, 120) || 'Empty block'}
                    </div>
                  </motion.div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Variables</h3>
            <p className="text-sm text-muted-foreground">
              Define reusable fields referenced in blocks via{' '}
              <code>{'{{variables.key}}'}</code>.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={handleAddVariable}>
            <Plus className="mr-2 h-4 w-4" /> Add variable
          </Button>
        </div>
        <div className="space-y-4">
          {value.variables.length === 0 ? (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 p-6 text-sm text-muted-foreground">
              No variables defined. Blocks can still render static content.
            </div>
          ) : (
            value.variables.map((variable, index) => (
              <Card
                key={`${variable.key}-${index}`}
                className="border-border/70"
              >
                <CardContent className="space-y-4 pt-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Key</Label>
                      <Input
                        value={variable.key}
                        onChange={(event) =>
                          handleVariableChange(index, 'key', event.target.value)
                        }
                        placeholder="project"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Label</Label>
                      <Input
                        value={variable.label}
                        onChange={(event) =>
                          handleVariableChange(
                            index,
                            'label',
                            event.target.value
                          )
                        }
                        placeholder="Project name"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Default value</Label>
                      <Input
                        value={variable.defaultValue ?? ''}
                        onChange={(event) =>
                          handleVariableChange(
                            index,
                            'defaultValue',
                            event.target.value
                          )
                        }
                        placeholder="untitled"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Description</Label>
                      <Input
                        value={variable.description ?? ''}
                        onChange={(event) =>
                          handleVariableChange(
                            index,
                            'description',
                            event.target.value
                          )
                        }
                        placeholder="Shown in chat overrides"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`variable-required-${variable.key}-${index}`}
                        checked={variable.required ?? false}
                        onCheckedChange={(checked) =>
                          handleVariableChange(
                            index,
                            'required',
                            Boolean(checked)
                          )
                        }
                      />
                      <Label
                        htmlFor={`variable-required-${variable.key}-${index}`}
                        className="text-sm"
                      >
                        Required when launching a chat
                      </Label>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => handleRemoveVariable(index)}
                      aria-label="Remove variable"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

interface SortablePromptBlockCardProps {
  block: AgentPromptBlock;
  index: number;
  isRolled: boolean;
  isActive?: boolean;
  onToggleRoll: () => void;
  onChange: (patch: Partial<AgentPromptBlock>) => void;
  onRemove: () => void;
}

function SortablePromptBlockCard({
  block,
  index,
  isRolled,
  isActive,
  onToggleRoll,
  onChange,
  onRemove,
}: SortablePromptBlockCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    pointerEvents: isDragging
      ? ('none' as CSSProperties['pointerEvents'])
      : undefined,
  };

  const previewSource = (block.template ?? '').replace(/\s+/g, ' ').trim();
  const preview = previewSource.length
    ? previewSource.length > 140
      ? `${previewSource.slice(0, 140)}…`
      : previewSource
    : 'Empty block';
  const depthDescriptor =
    block.depth === undefined
      ? 'auto'
      : block.depth === 0
        ? 'append'
        : block.depth;

  return (
    <motion.div
      ref={setNodeRef}
      style={{ ...style, zIndex: isDragging ? 50 : undefined }}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      <Card
        className={cn(
          'border-border/70 bg-background transition-shadow',
          isDragging &&
            'scale-[0.98] border-dashed opacity-40 shadow-xl ring-2 ring-primary/40',
          isActive && !isDragging && 'ring-2 ring-primary/30'
        )}
      >
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  'mt-1 cursor-grab text-muted-foreground hover:text-foreground',
                  isDragging && 'cursor-grabbing'
                )}
                aria-label="Reorder block"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="truncate text-base">
                    {block.title || `Block ${index + 1}`}
                  </CardTitle>
                  {!block.enabled && (
                    <Badge variant="secondary">Disabled</Badge>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <span>{ROLE_LABELS[block.role]}</span>
                  <span>· Depth {depthDescriptor}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Switch
                id={`block-enabled-${block.id}`}
                checked={block.enabled}
                onCheckedChange={(checked: boolean) =>
                  onChange({
                    enabled: Boolean(checked),
                  })
                }
                aria-label={block.enabled ? 'Disable block' : 'Enable block'}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onToggleRoll}
                aria-label={isRolled ? 'Expand block' : 'Collapse block'}
              >
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform',
                    isRolled && '-rotate-90'
                  )}
                />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onRemove}
                aria-label="Remove block"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {isRolled && (
            <motion.p
              layout="position"
              className="truncate text-sm text-muted-foreground"
            >
              <span className="font-medium text-muted-foreground">
                {ROLE_LABELS[block.role]} · Depth {depthDescriptor} ·{' '}
              </span>
              {preview}
            </motion.p>
          )}
        </CardHeader>
        <AnimatePresence initial={false}>
          {!isRolled && (
            <motion.div
              key="content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
            >
              <CardContent className="space-y-4 border-t border-border/60 pt-6">
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor={`block-title-${block.id}`}>Title</Label>
                    <Input
                      id={`block-title-${block.id}`}
                      value={block.title}
                      onChange={(event) =>
                        onChange({
                          title: event.target.value,
                        })
                      }
                      placeholder="e.g. Memory context"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`block-role-${block.id}`}>Role</Label>
                    <Select
                      value={block.role}
                      onValueChange={(value) =>
                        onChange({
                          role: value as AgentPromptBlock['role'],
                        })
                      }
                    >
                      <SelectTrigger id={`block-role-${block.id}`}>
                        <SelectValue placeholder="System" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system">System</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="assistant">Assistant</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`block-depth-${block.id}`}>Depth</Label>
                    <Input
                      id={`block-depth-${block.id}`}
                      type="number"
                      min={0}
                      value={typeof block.depth === 'number' ? block.depth : ''}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === '') {
                          onChange({ depth: undefined });
                          return;
                        }
                        const numeric = Number(raw);
                        if (!Number.isFinite(numeric)) {
                          onChange({ depth: undefined });
                          return;
                        }
                        const normalized = Math.max(0, Math.floor(numeric));
                        onChange({ depth: normalized });
                      }}
                      placeholder="Auto"
                    />
                    <p className="text-xs text-muted-foreground">
                      Overrides where the message inserts in the chat history.
                      Depth 0 appends after the last message; higher values
                      insert nearer the top. Leave blank to append
                      automatically.
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`block-template-${block.id}`}>
                    Prompt template
                  </Label>
                  <Textarea
                    id={`block-template-${block.id}`}
                    value={block.template}
                    onChange={(event) =>
                      onChange({
                        template: event.target.value,
                      })
                    }
                    rows={6}
                    placeholder={'You are ...'}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use handlebars-style variables like{' '}
                    <code>{'{{variables.project}}'}</code>. Blocks render in the
                    order shown above.
                  </p>
                </div>
                <div className="max-w-sm space-y-1">
                  <Label htmlFor={`block-separator-${block.id}`}>
                    Trailing separator
                  </Label>
                  <Input
                    id={`block-separator-${block.id}`}
                    value={block.separator ?? ''}
                    onChange={(event) =>
                      onChange({
                        separator: event.target.value || undefined,
                      })
                    }
                    placeholder={'\n'}
                  />
                  <p className="text-xs text-muted-foreground">
                    Overrides the global joiner for this block.
                  </p>
                </div>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

export default AgentPromptEditor;
