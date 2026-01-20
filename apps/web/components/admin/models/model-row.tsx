'use client';

import { CreatorLogo } from '@/components/creator-logo';
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
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  ManagedModelCapabilities,
  ModelProviderAssociation,
} from '@/lib/ai/model-capabilities';
import { displayProviderName } from '@/lib/ai/registry';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Edit,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  Unlink,
} from 'lucide-react';
import { useState } from 'react';

type ModelRowProps = {
  model: ManagedModelCapabilities;
  onEdit: (model: ManagedModelCapabilities) => void;
  onDelete: (model: ManagedModelCapabilities) => void;
  onAddProvider: (model: ManagedModelCapabilities) => void;
  onEditProvider: (model: ManagedModelCapabilities, providerId: string) => void;
  onRemoveProvider: (modelId: string, providerId: string) => void;
  onSetDefaultProvider: (modelId: string, providerId: string) => void;
};

export function ModelRow({
  model,
  onEdit,
  onDelete,
  onAddProvider,
  onEditProvider,
  onRemoveProvider,
  onSetDefaultProvider,
}: ModelRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden"
    >
      {/* Header / Main Row */}
      <div className="flex items-center gap-4 p-4">
        {/* Icon/Logo */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          <CreatorLogo
            creatorSlug={model.creator || 'unknown'}
            className="h-5 w-5 object-contain"
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium truncate" title={model.name}>
              {model.name}
            </h4>
            {model.supportsTools && (
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                Tools
              </Badge>
            )}
            {model.isPersisted && (
              <Badge
                variant="outline"
                className="text-[10px] h-5 px-1.5 border-blue-200 text-blue-700 dark:border-blue-900 dark:text-blue-400"
              >
                Persisted
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {model.id}
            {model.supportedFormats.length > 0 && (
              <span className="opacity-70">
                {' • ' + model.supportedFormats.join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:block text-right text-xs text-muted-foreground w-28">
          {model.providers.length} provider
          {model.providers.length !== 1 ? 's' : ''}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ButtonWithFeedback
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onEdit(model)}
                >
                  <Edit className="h-4 w-4" />
                  <span className="sr-only">Edit</span>
                </ButtonWithFeedback>
              </TooltipTrigger>
              <TooltipContent>Edit model</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => onEdit(model)}>
                <Edit className="mr-2 h-4 w-4" /> Edit Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddProvider(model)}>
                <Plus className="mr-2 h-4 w-4" /> Add Provider
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(model)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete Model
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Provider List */}
      <div className="border-t bg-muted/20 px-4 py-3 text-sm">
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Linked Providers
          </h5>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ButtonWithFeedback
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => onAddProvider(model)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add
                </ButtonWithFeedback>
              </TooltipTrigger>
              <TooltipContent>Link a new provider</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {model.providers.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-2">
            No providers linked. This model cannot be used until a provider is
            added.
          </div>
        ) : (
          <div className="space-y-2">
            {model.providers.map((p) => (
              <ProviderRow
                key={p.providerId}
                provider={p}
                modelId={model.id}
                onEdit={() => onEditProvider(model, p.providerId)}
                onRemove={() => onRemoveProvider(model.id, p.providerId)}
                onSetDefault={() =>
                  onSetDefaultProvider(model.id, p.providerId)
                }
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ProviderRow({
  provider,
  modelId,
  onEdit,
  onRemove,
  onSetDefault,
}: {
  provider: ModelProviderAssociation;
  modelId: string;
  onEdit: () => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
  const isCustomProvider = !!provider.customPlatformProviderId;

  const handleUnlink = () => {
    onRemove();
    setUnlinkDialogOpen(false);
  };

  const providerDisplayName = isCustomProvider
    ? (provider.customProviderName ?? 'Custom')
    : displayProviderName(provider.providerId);

  return (
    <>
      <div
        className={cn(
          'group flex items-center justify-between rounded-md border bg-background px-3 py-2 transition-colors',
          provider.isDefault && 'border-primary/20 bg-primary/5',
          isCustomProvider && 'border-violet-200 dark:border-violet-800/50'
        )}
      >
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-normal">
            {isCustomProvider ? (
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-violet-500" />
                {provider.customProviderName ?? 'Custom'}
              </span>
            ) : (
              displayProviderName(provider.providerId)
            )}
          </Badge>
          <span className="text-xs font-mono text-muted-foreground">
            {provider.providerModelId}
          </span>
          {provider.isDefault && (
            <Badge variant="default" className="text-[10px] h-4 px-1">
              Default
            </Badge>
          )}
          {isCustomProvider && !provider.isDefault && (
            <Badge
              variant="secondary"
              className="text-[9px] h-4 px-1 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
            >
              Custom Provider
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!provider.isDefault && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={onSetDefault}
                  >
                    <div className="h-3 w-3 rounded-full border border-primary/50" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Set as default</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={onEdit}
                >
                  <Edit className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit provider settings</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => setUnlinkDialogOpen(true)}
                >
                  <Unlink className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Unlink provider</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Unlink Confirmation Dialog */}
      <AlertDialog open={unlinkDialogOpen} onOpenChange={setUnlinkDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlink Provider</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to unlink{' '}
              <strong>{providerDisplayName}</strong> from this model? The model
              will no longer be able to use this provider for generation.
              {provider.isDefault && (
                <span className="block mt-2 text-yellow-600 dark:text-yellow-500">
                  This is currently the default provider. You&apos;ll need to
                  set another provider as default.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnlink}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Unlink Provider
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
