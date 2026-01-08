'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';
import { ArchiveDetail } from '@/components/archive/archive-detail';
import { ArchiveList } from '@/components/archive/archive-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { useFeedbackState } from '@/hooks/use-feedback-state';
import { useMultiSelection } from '@/hooks/use-multi-selection';
import {
  Search,
  Plus,
  Sparkles,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Trash2,
  CheckSquare,
} from 'lucide-react';
import {
  useArchiveEntry,
  useCreateArchiveEntry,
  useUpdateArchiveEntry,
  useDeleteArchiveEntries,
  useArchiveSearch,
  type ArchiveListEntry,
} from '@/hooks/use-archive';

export function ArchiveExplorer() {
  const [q, setQ] = useState('');
  const [current, setCurrent] = useState<string | undefined>();
  const [openNew, setOpenNew] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openDeleteConfirm, setOpenDeleteConfirm] = useState(false);
  const [status, setStatus] = useState<
    'idle' | 'created' | 'updated' | 'error'
  >('idle');
  const statusTimerRef = useRef<number | null>(null);
  const [saveFeedback, setSaveFeedback] = useFeedbackState();

  // Multi-selection state
  const {
    isSelectionMode,
    selectedSet: selectedSlugs,
    selectedIds: selectedSlugsArray,
    selectedCount,
    selectAll,
    stopSelectionMode: clearSelectionMode,
    toggleSelection,
    toggleSelectionRange,
    handlePressStart,
    handlePressEnd,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useMultiSelection<string>();
  const [isDeletingMultiple, setIsDeletingMultiple] = useState(false);

  const { data: selected } = useArchiveEntry(current);
  const createMutation = useCreateArchiveEntry();
  const updateMutation = useUpdateArchiveEntry();
  const bulkDeleteMutation = useDeleteArchiveEntries();
  const { data: archiveData } = useArchiveSearch({ q });
  const archives: ArchiveListEntry[] =
    (archiveData as any)?.pages?.flatMap((page: any) => page.entries) || [];

  const tagSchema = z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^,]+$/, 'Commas not allowed');
  const baseSchema = z.object({
    entity: z
      .string()
      .trim()
      .min(2, 'Entity must be at least 2 characters')
      .max(200),
    body: z.string().trim().max(20_000).optional().or(z.literal('')),
    tags: z.array(tagSchema).max(24, 'Too many tags'),
    tagInput: z.string().optional(),
  });

  type FormValues = z.infer<typeof baseSchema>;

  const createForm = useForm<FormValues>({
    resolver: zodResolver(baseSchema as any),
    defaultValues: { entity: '', body: '', tags: [], tagInput: '' },
    mode: 'onChange',
  });

  const editForm = useForm<FormValues>({
    resolver: zodResolver(baseSchema as any),
    defaultValues: { entity: '', body: '', tags: [], tagInput: '' },
  });

  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (selected && openEdit) {
      editForm.reset({
        entity: selected.entity,
        body: selected.body,
        tags: selected.tags,
        tagInput: '',
      });
    }
  }, [selected, openEdit, editForm]);

  const addTag = useCallback((form: typeof createForm | typeof editForm) => {
    const ti = form.getValues('tagInput')?.trim();
    if (!ti) return;
    const tags = form.getValues('tags');
    if (!tags.includes(ti))
      form.setValue('tags', [...tags, ti], {
        shouldDirty: true,
        shouldValidate: true,
      });
    form.setValue('tagInput', '');
  }, []);

  const removeTag = useCallback(
    (form: typeof createForm | typeof editForm, tag: string) => {
      const tags = form.getValues('tags').filter((t: string) => t !== tag);
      form.setValue('tags', tags, { shouldDirty: true, shouldValidate: true });
    },
    []
  );

  const showStatus = useCallback((next: typeof status, ttl = 1800) => {
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current);
    }
    if (next === 'idle') {
      setStatus('idle');
      statusTimerRef.current = null;
      return;
    }
    setStatus(next);
    statusTimerRef.current = window.setTimeout(() => {
      setStatus('idle');
      statusTimerRef.current = null;
    }, ttl);
  }, []);

  const handleCreate = createForm.handleSubmit(async (values: FormValues) => {
    try {
      const { slug } = await createMutation.mutateAsync({
        entity: values.entity.trim(),
        body: values.body?.trim() || undefined,
        tags: values.tags,
      });
      toast.success('Entry created');
      setOpenNew(false);
      createForm.reset();
      setCurrent(slug);
      showStatus('created');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create entry');
      showStatus('error', 2400);
    }
  });

  const handleUpdate = editForm.handleSubmit(async (values: FormValues) => {
    if (!current) return;
    setSaveFeedback('loading');
    try {
      const original = selected?.tags || [];
      const addTags = values.tags.filter((t: string) => !original.includes(t));
      const removeTags = original.filter(
        (t: string) => !values.tags.includes(t)
      );
      await updateMutation.mutateAsync({
        slug: current,
        entity: values.entity.trim(),
        body: values.body?.trim(),
        addTags: addTags.length ? addTags : undefined,
        removeTags: removeTags.length ? removeTags : undefined,
      });
      toast.success('Entry updated');
      setOpenEdit(false);
      showStatus('updated');
      setSaveFeedback('success', 1600);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update entry');
      showStatus('error', 2400);
      setSaveFeedback('error', 2200);
    }
  });

  function openEditDialog() {
    if (!selected) return;
    editForm.reset({
      entity: selected.entity,
      body: selected.body,
      tags: selected.tags,
      tagInput: '',
    });
    setOpenEdit(true);
  }

  // Multi-selection helpers built on shared hook
  const handleSelectAll = useCallback(() => {
    if (!archives || archives.length === 0) return;
    selectAll(archives.map((archive: ArchiveListEntry) => archive.slug));
  }, [archives, selectAll]);

  const handleConfirmDeleteSelected = useCallback(async () => {
    if (selectedCount === 0) return;

    setOpenDeleteConfirm(false);
    setIsDeletingMultiple(true);
    try {
      await bulkDeleteMutation.mutateAsync({
        slugs: selectedSlugsArray,
      });

      toast.success(
        `Deleted ${selectedCount} ${selectedCount === 1 ? 'entry' : 'entries'}`
      );
      clearSelectionMode();

      // Clear current selection if it was deleted
      if (current && selectedSlugs.has(current)) {
        setCurrent(undefined);
      }
    } catch (error) {
      toast.error('Failed to delete some entries');
    } finally {
      setIsDeletingMultiple(false);
    }
  }, [
    selectedCount,
    selectedSlugsArray,
    current,
    selectedSlugs,
    clearSelectionMode,
    bulkDeleteMutation,
  ]);

  const handleShiftClick = useCallback(
    (slug: string) => {
      if (!archives || archives.length === 0) {
        toggleSelection(slug);
        return;
      }
      const orderedSlugs = archives.map(
        (archive: ArchiveListEntry) => archive.slug
      );
      toggleSelectionRange(slug, orderedSlugs);
    },
    [archives, toggleSelection, toggleSelectionRange]
  );

  const mutationInFlight =
    createMutation.isPending ||
    updateMutation.isPending ||
    bulkDeleteMutation.isPending ||
    isDeletingMultiple;
  const statusLabel =
    status === 'created'
      ? 'Entry created'
      : status === 'updated'
        ? 'Changes saved'
        : 'Unable to save changes';

  return (
    <motion.div
      className="flex h-full min-h-0 gap-5 rounded-3xl border border-border/60 bg-muted/10 p-5 shadow-sm backdrop-blur"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.21, 1.02, 0.73, 1] }}
    >
      <motion.section
        className="flex w-full max-w-xs flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/75 shadow-sm backdrop-blur-sm h-full"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.05, ease: [0.21, 1.02, 0.73, 1] }}
      >
        <div className="border-b border-border/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Archive
            </div>
            <Dialog
              open={openNew}
              onOpenChange={(o) => {
                setOpenNew(o);
                if (!o) createForm.reset();
              }}
            >
              <DialogTrigger asChild>
                <Button
                  asChild
                  size="sm"
                  variant="secondary"
                  className="rounded-full shadow-sm"
                  disabled={createMutation.isPending}
                >
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                    className="flex items-center gap-1"
                  >
                    {createMutation.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Working…
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        New
                      </>
                    )}
                  </motion.button>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Archive Entry</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Entity</label>
                    <Input
                      {...createForm.register('entity')}
                      placeholder="e.g. Project Phoenix"
                    />
                    {createForm.formState.errors.entity && (
                      <p className="text-xs text-destructive">
                        {createForm.formState.errors.entity.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Tags</label>
                    <div className="flex flex-wrap gap-2 pb-1">
                      <AnimatePresence>
                        {createForm.watch('tags').map((t: string) => (
                          <motion.div
                            key={t}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 500,
                              damping: 30,
                            }}
                          >
                            <Badge
                              variant="secondary"
                              className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
                              onClick={() => removeTag(createForm, t)}
                            >
                              {t}
                            </Badge>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        {...createForm.register('tagInput')}
                        placeholder="Add tag and press Enter"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(createForm);
                          }
                        }}
                      />
                      {createForm.watch('tagInput') && (
                        <motion.div whileTap={{ scale: 0.95 }}>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => addTag(createForm)}
                          >
                            Add
                          </Button>
                        </motion.div>
                      )}
                    </div>
                    {createForm.formState.errors.tags && (
                      <p className="text-xs text-destructive">
                        {createForm.formState.errors.tags.message as string}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Body</label>
                    <Textarea
                      {...createForm.register('body')}
                      rows={10}
                      placeholder="Structured long-form content..."
                    />
                    {createForm.formState.errors.body && (
                      <p className="text-xs text-destructive">
                        {createForm.formState.errors.body.message}
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setOpenNew(false)}
                      disabled={createMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        !createForm.formState.isValid ||
                        createMutation.isPending
                      }
                    >
                      {createMutation.isPending ? 'Creating…' : 'Create'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          <div className="mt-3">
            <div className="relative">
              <Input
                placeholder="Search archive…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-9 rounded-xl bg-muted/40 pl-9 pr-3"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>

          {/* Selection Mode Controls */}
          <AnimatePresence>
            {isSelectionMode && selectedCount > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="mt-3 p-3 bg-muted/50 rounded-lg border"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      {selectedCount} of {archives?.length || 0} selected
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAll}
                      disabled={isDeletingMultiple}
                      className="flex-1 min-w-0"
                    >
                      All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearSelectionMode}
                      disabled={isDeletingMultiple}
                      className="flex-1 min-w-0"
                    >
                      Cancel
                    </Button>
                    <AlertDialog
                      open={openDeleteConfirm}
                      onOpenChange={setOpenDeleteConfirm}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={selectedCount === 0 || isDeletingMultiple}
                          className="flex-1 min-w-0"
                        >
                          {isDeletingMultiple ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete Archive Entries
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete {selectedCount}{' '}
                            archive
                            {selectedCount === 1 ? 'entry' : 'entries'}? This
                            action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel
                            disabled={bulkDeleteMutation.isPending}
                          >
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleConfirmDeleteSelected}
                            disabled={bulkDeleteMutation.isPending}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {bulkDeleteMutation.isPending ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Deleting...
                              </>
                            ) : (
                              'Delete'
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 min-h-0">
          <ArchiveList
            q={q || undefined}
            onSelect={setCurrent}
            activeSlug={current}
            isSelectionMode={isSelectionMode}
            selectedSlugs={selectedSlugs}
            onToggleSelection={toggleSelection}
            onPressStart={handlePressStart}
            onPressEnd={handlePressEnd}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onShiftClick={handleShiftClick}
            archiveData={archiveData}
          />
        </div>
      </motion.section>

      <motion.section
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background/75 shadow-sm backdrop-blur-sm"
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.05, ease: [0.21, 1.02, 0.73, 1] }}
      >
        <AnimatePresence>
          {mutationInFlight && (
            <motion.span
              key="archive-progress"
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/30 via-primary to-primary/30"
              initial={{ scaleX: 0, originX: 0 }}
              animate={{ scaleX: 1, originX: 0 }}
              exit={{ scaleX: 0, originX: 1 }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                repeatType: 'mirror',
                ease: 'linear',
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence mode="popLayout">
          {status !== 'idle' && (
            <motion.div
              key={status}
              className={`absolute right-4 top-4 flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium shadow-sm ${
                status === 'error'
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-emerald-500/10 text-emerald-500'
              }`}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              {status === 'error' ? (
                <CircleAlert className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {statusLabel}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute right-4 top-4 flex gap-2">
          {current && selected && (
            <Dialog
              open={openEdit}
              onOpenChange={(o) => {
                setOpenEdit(o);
                if (!o) editForm.reset();
              }}
            >
              <Button
                asChild
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={updateMutation.isPending}
              >
                <motion.button
                  type="button"
                  onClick={openEditDialog}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  className="flex items-center gap-2"
                >
                  Edit
                </motion.button>
              </Button>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Entry</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleUpdate} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Entity</label>
                    <Input {...editForm.register('entity')} />
                    {editForm.formState.errors.entity && (
                      <p className="text-xs text-destructive">
                        {editForm.formState.errors.entity.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">
                      Tags (remove by click)
                    </label>
                    <div className="flex flex-wrap gap-2 pb-1">
                      <AnimatePresence>
                        {editForm.watch('tags').map((t: string) => (
                          <motion.div
                            key={t}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 500,
                              damping: 30,
                            }}
                          >
                            <Badge
                              variant="secondary"
                              className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground transition-colors"
                              onClick={() => removeTag(editForm, t)}
                            >
                              {t}
                            </Badge>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        {...editForm.register('tagInput')}
                        placeholder="Add tag and press Enter"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag(editForm);
                          }
                        }}
                      />
                      {editForm.watch('tagInput') && (
                        <motion.div whileTap={{ scale: 0.95 }}>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => addTag(editForm)}
                          >
                            Add
                          </Button>
                        </motion.div>
                      )}
                    </div>
                    {editForm.formState.errors.tags && (
                      <p className="text-xs text-destructive">
                        {editForm.formState.errors.tags.message as string}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Body</label>
                    <Textarea {...editForm.register('body')} rows={14} />
                    {editForm.formState.errors.body && (
                      <p className="text-xs text-destructive">
                        {editForm.formState.errors.body.message}
                      </p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setOpenEdit(false)}
                      disabled={updateMutation.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={updateMutation.isPending}
                      className="relative"
                    >
                      <AnimatedButtonLabel
                        state={saveFeedback}
                        idleLabel="Save"
                        loadingLabel="Saving…"
                        successLabel="Saved"
                        errorLabel="Error"
                      />
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <ArchiveDetail
            slug={current}
            onDeleted={() => {
              setCurrent(undefined);
            }}
          />
        </div>
      </motion.section>
    </motion.div>
  );
}
