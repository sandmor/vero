'use client';
import {
  useArchiveEntry,
  useDeleteArchiveEntry,
  useLinkArchiveEntries,
  useUnlinkArchiveEntries,
  useArchiveSlugSuggestions,
} from '@/hooks/use-archive';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  Trash2,
  Link as LinkIcon,
  Plus,
  X,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function ArchiveDetail({
  slug,
  onDeleted,
}: {
  slug?: string;
  onDeleted?: () => void;
}) {
  const { data, isLoading } = useArchiveEntry(slug);
  const deleteMutation = useDeleteArchiveEntry();
  const linkMutation = useLinkArchiveEntries();
  const unlinkMutation = useUnlinkArchiveEntries();
  const [linkTarget, setLinkTarget] = useState('');
  const [linkType, setLinkType] = useState('related');
  const { data: slugSuggestions, isFetching: loadingSuggestions } =
    useArchiveSlugSuggestions(linkTarget);

  useEffect(() => {
    // scroll to top on slug change
    const container = document.getElementById('archive-detail-area');
    if (container) container.scrollTop = 0;
  }, [slug]);

  if (!slug) {
    return (
      <motion.div
        className="flex h-full items-center justify-center p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Entry Selected</h3>
            <p className="text-sm text-muted-foreground">
              Select an entry from the list to view its contents.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }
  if (isLoading) {
    return (
      <motion.div
        className="p-6 space-y-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-1/2" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-4 w-1/3" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </CardContent>
        </Card>
      </motion.div>
    );
  }
  if (!data)
    return (
      <motion.div
        className="flex h-full items-center justify-center p-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <X className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="text-lg font-medium mb-2">Entry Not Found</h3>
            <p className="text-sm text-muted-foreground">
              The requested archive entry could not be found.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    );

  async function handleDelete() {
    if (!slug) return;
    if (!confirm('Delete this entry?')) return;
    try {
      await deleteMutation.mutateAsync({ slug });
      toast.success('Entry deleted');
      onDeleted?.();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delete');
    }
  }

  async function handleLink() {
    if (!slug || !linkTarget.trim()) return;
    try {
      await linkMutation.mutateAsync({
        sourceSlug: slug,
        targetSlug: linkTarget.trim(),
        type: linkType,
        bidirectional: true,
      });
      toast.success('Link added');
      setLinkTarget('');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to link');
    }
  }

  async function handleUnlink(otherSlug: string, type: string) {
    if (!slug) return;
    try {
      await unlinkMutation.mutateAsync({
        sourceSlug: slug,
        targetSlug: otherSlug,
        type,
      });
      toast.success('Link removed');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to unlink');
    }
  }

  return (
    <motion.div
      className="flex h-full flex-col gap-4 p-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="text-xl leading-tight">
                {data.entity}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <AnimatePresence>
                  {data.tags.map((t) => (
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
                      <Badge variant="secondary" className="text-xs">
                        {t}
                      </Badge>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              <CardDescription>
                Updated{' '}
                {formatDistanceToNow(new Date(data.updatedAt), {
                  addSuffix: true,
                })}
              </CardDescription>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <motion.div whileTap={{ scale: 0.95 }}>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-2" />
                    )}
                    Delete
                  </Button>
                </motion.div>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Archive Entry</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete &ldquo;{data.entity}&rdquo;?
                    This action cannot be undone.
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
        </CardHeader>
      </Card>

      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-lg">Content</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea id="archive-detail-area" className="h-full">
            <div className="prose dark:prose-invert max-w-none p-6">
              {data.body.split(/\n{2,}/).map((para, idx) => (
                <p key={idx} className="whitespace-pre-wrap mb-4 last:mb-0">
                  {para}
                </p>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LinkIcon className="h-5 w-5" />
            Links
          </CardTitle>
          <CardDescription>
            Manage connections to other archive entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Existing Links</label>
            <div className="flex flex-wrap gap-2">
              <AnimatePresence>
                {data.links.map((l, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="flex items-center gap-1 rounded-md bg-muted px-3 py-1 text-sm"
                  >
                    <span className="text-muted-foreground">{l.type}:</span>
                    <span className="font-medium">{l.otherSlug}</span>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      className="text-destructive hover:text-destructive/80 ml-1"
                      onClick={() => handleUnlink(l.otherSlug, l.type)}
                    >
                      <X className="h-3 w-3" />
                    </motion.button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {data.links.length === 0 && (
                <p className="text-sm text-muted-foreground">No links yet</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Add New Link</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Input
                  placeholder="Target entry slug"
                  value={linkTarget}
                  onChange={(e) => setLinkTarget(e.target.value)}
                  className="pr-8"
                />
                {loadingSuggestions && (
                  <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
                {slugSuggestions &&
                  slugSuggestions.length > 0 &&
                  linkTarget.length >= 2 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
                    >
                      <ul className="max-h-56 overflow-y-auto text-sm">
                        {slugSuggestions.map((s) => (
                          <li key={s.slug}>
                            <button
                              type="button"
                              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                              onClick={() => setLinkTarget(s.slug)}
                            >
                              <span
                                className="font-medium truncate max-w-[8rem]"
                                title={s.slug}
                              >
                                {s.slug}
                              </span>
                              <span
                                className="truncate text-muted-foreground max-w-[10rem]"
                                title={s.entity}
                              >
                                {s.entity}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
              </div>
              <Input
                placeholder="Link type"
                value={linkType}
                onChange={(e) => setLinkType(e.target.value)}
                className="sm:w-32"
              />
              <motion.div whileTap={{ scale: 0.95 }}>
                <Button
                  onClick={handleLink}
                  disabled={linkMutation.isPending || !linkTarget.trim()}
                  className="sm:w-auto"
                >
                  {linkMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Add Link
                </Button>
              </motion.div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
