'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Server, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import { getAllProviders } from '@/lib/ai/registry';
import { cn } from '@/lib/utils';

// Base schema with conditional validation using superRefine
const formSchema = z
  .object({
    providerType: z.enum(['platform', 'custom']),
    providerId: z.string().optional(),
    customProviderId: z.string().optional(),
    providerModelId: z.string().min(1, 'Provider Model ID is required'),
  })
  .superRefine((data, ctx) => {
    // Conditional validation based on provider type
    if (data.providerType === 'platform') {
      if (!data.providerId || data.providerId.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Platform provider is required',
          path: ['providerId'],
        });
      }
    } else if (data.providerType === 'custom') {
      if (!data.customProviderId || data.customProviderId.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Custom provider is required',
          path: ['customProviderId'],
        });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

type CustomProvider = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
};

type AddProviderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string | null;
  onSave: (data: {
    providerId: string;
    providerModelId: string;
    customPlatformProviderId?: string;
  }) => Promise<void>;
};

export function AddProviderDialog({
  open,
  onOpenChange,
  modelId,
  onSave,
}: AddProviderDialogProps) {
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch standard providers
  const providers = useMemo(() => getAllProviders(), []);

  // Fetch custom platform providers
  const { data: customProviders = [], isLoading: loadingCustom } = useQuery<
    CustomProvider[]
  >({
    queryKey: ['platform-providers'],
    queryFn: async () => {
      const res = await fetch('/api/admin/platform-providers');
      if (!res.ok) return [];
      const json = await res.json();
      return (json.providers ?? []).filter((p: CustomProvider) => p.enabled);
    },
    enabled: open,
    staleTime: 30_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      providerType: 'platform',
      providerId: '',
      customProviderId: '',
      providerModelId: '',
    },
    mode: 'onSubmit', // Validate on submit to avoid premature errors
  });

  const providerType = form.watch('providerType');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset({
        providerType: 'platform',
        providerId: '',
        customProviderId: '',
        providerModelId: '',
      });
      setSubmitError(null);
    }
  }, [open, form]);

  // When provider type changes, clear errors for the other field and reset selection
  useEffect(() => {
    if (providerType === 'platform') {
      form.setValue('customProviderId', '');
      form.clearErrors('customProviderId');
    } else {
      form.setValue('providerId', '');
      form.clearErrors('providerId');
    }
  }, [providerType, form]);

  const onSubmit = async (values: FormValues) => {
    setLoading(true);
    setSubmitError(null);
    try {
      if (values.providerType === 'custom' && values.customProviderId) {
        // For custom providers, use a special provider ID format
        const customProvider = customProviders.find(
          (p) => p.id === values.customProviderId
        );
        await onSave({
          providerId: `custom:${customProvider?.slug ?? values.customProviderId}`,
          providerModelId: values.providerModelId,
          customPlatformProviderId: values.customProviderId,
        });
      } else if (values.providerType === 'platform' && values.providerId) {
        await onSave({
          providerId: values.providerId,
          providerModelId: values.providerModelId,
        });
      }
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to link provider';
      setSubmitError(message);
    } finally {
      setLoading(false);
    }
  };

  const hasCustomProviders = customProviders.length > 0;

  // Check if form has any errors
  const formErrors = form.formState.errors;
  const hasErrors = Object.keys(formErrors).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Link Provider</DialogTitle>
          <DialogDescription>
            Associate a provider implementation with <strong>{modelId}</strong>.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Error Display */}
            <AnimatePresence>
              {(submitError || (hasErrors && form.formState.isSubmitted)) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {submitError ||
                        'Please fix the errors below before submitting.'}
                    </AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Provider Type Selector */}
            {hasCustomProviders && (
              <FormField
                control={form.control}
                name="providerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider Type</FormLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <motion.button
                        type="button"
                        onClick={() => field.onChange('platform')}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border-2 p-3 text-left transition-all',
                          field.value === 'platform'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-muted-foreground/50'
                        )}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium">Platform</div>
                          <div className="text-xs text-muted-foreground">
                            Built-in providers
                          </div>
                        </div>
                      </motion.button>
                      <motion.button
                        type="button"
                        onClick={() => field.onChange('custom')}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border-2 p-3 text-left transition-all',
                          field.value === 'custom'
                            ? 'border-violet-500 bg-violet-500/5'
                            : 'border-border hover:border-muted-foreground/50'
                        )}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        <Sparkles className="h-4 w-4 text-violet-500" />
                        <div>
                          <div className="text-sm font-medium">Custom</div>
                          <div className="text-xs text-muted-foreground">
                            Your custom providers
                          </div>
                        </div>
                      </motion.button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Provider Selection */}
            <AnimatePresence mode="wait">
              {providerType === 'platform' ? (
                <motion.div
                  key="platform"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.15 }}
                >
                  <FormField
                    control={form.control}
                    name="providerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Platform Provider</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger
                              className={cn(
                                formErrors.providerId && 'border-destructive'
                              )}
                            >
                              <SelectValue placeholder="Select a provider" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {providers.map((provider) => (
                              <SelectItem key={provider.id} value={provider.id}>
                                <div className="flex items-center gap-2">
                                  <span>{provider.name}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="custom"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.15 }}
                >
                  <FormField
                    control={form.control}
                    name="customProviderId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Custom Provider
                          <Badge
                            variant="secondary"
                            className="ml-2 text-[9px] px-1.5 py-0 h-4 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                          >
                            Custom
                          </Badge>
                        </FormLabel>
                        {loadingCustom ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading custom providers...
                          </div>
                        ) : (
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger
                                className={cn(
                                  formErrors.customProviderId &&
                                    'border-destructive'
                                )}
                              >
                                <SelectValue placeholder="Select a custom provider" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {customProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={provider.id}
                                >
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="h-3 w-3 text-violet-500" />
                                    <span>{provider.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      ({provider.slug})
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <FormDescription>
                          Routes this model through your custom
                          OpenAI-compatible endpoint.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Provider Model ID */}
            <FormField
              control={form.control}
              name="providerModelId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider Model ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. gpt-4-turbo-preview"
                      className={cn(
                        formErrors.providerModelId && 'border-destructive'
                      )}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The exact model ID used by the provider API.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <ButtonWithFeedback type="submit" disabled={loading}>
                {loading ? 'Linking...' : 'Link Provider'}
              </ButtonWithFeedback>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
