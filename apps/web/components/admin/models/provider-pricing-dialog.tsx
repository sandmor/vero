'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import { cn } from '@/lib/utils';
import type {
  ModelPricing,
  ModelProviderAssociation,
} from '@/lib/ai/model-capabilities/types';

const formSchema = z.object({
  inputPrice: z.coerce.number().min(0).optional(),
  outputPrice: z.coerce.number().min(0).optional(),
  cacheReadPrice: z.coerce.number().min(0).optional(),
  cacheWritePrice: z.coerce.number().min(0).optional(),
  isDefault: z.boolean(),
  enabled: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

type ProviderPricingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modelId: string;
  provider: ModelProviderAssociation | null;
  onSave: (data: {
    pricing: ModelPricing;
    isDefault: boolean;
    enabled: boolean;
  }) => Promise<void>;
};

export function ProviderPricingDialog({
  open,
  onOpenChange,
  modelId,
  provider,
  onSave,
}: ProviderPricingDialogProps) {
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      inputPrice: 0,
      outputPrice: 0,
      cacheReadPrice: 0,
      cacheWritePrice: 0,
      isDefault: false,
      enabled: true,
    },
    mode: 'onSubmit',
  });

  const formErrors = form.formState.errors;
  const hasErrors = Object.keys(formErrors).length > 0;

  useEffect(() => {
    if (provider && open) {
      form.reset({
        inputPrice: provider.pricing?.prompt || 0,
        outputPrice: provider.pricing?.completion || 0,
        cacheReadPrice: provider.pricing?.cacheRead || 0,
        cacheWritePrice: provider.pricing?.cacheWrite || 0,
        isDefault: provider.isDefault,
        enabled: provider.enabled,
      });
      setSubmitError(null);
    }
  }, [provider, open, form]);

  const onSubmit = async (values: FormValues) => {
    if (!provider) return;
    setLoading(true);
    setSubmitError(null);
    try {
      const pricing: ModelPricing = {
        prompt: values.inputPrice,
        completion: values.outputPrice,
        cacheRead: values.cacheReadPrice,
        cacheWrite: values.cacheWritePrice,
        // Preserve other pricing fields if any (though we are only editing these)
        image: provider.pricing?.image,
        reasoning: provider.pricing?.reasoning,
      };

      await onSave({
        pricing,
        isDefault: values.isDefault,
        enabled: values.enabled,
      });
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to save provider settings';
      setSubmitError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Configure Provider</DialogTitle>
          <DialogDescription>
            Settings for <strong>{provider?.providerId}</strong> on{' '}
            <strong>{modelId}</strong>.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

            <div className="space-y-4">
              <h4 className="text-sm font-medium">Status</h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Enabled</FormLabel>
                        <FormDescription>
                          Use this provider for generation.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isDefault"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Default</FormLabel>
                        <FormDescription>Prefer this provider.</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-medium">Pricing (per 1M tokens)</h4>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="inputPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Input Price ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className={cn(
                            formErrors.inputPrice && 'border-destructive'
                          )}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="outputPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Output Price ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className={cn(
                            formErrors.outputPrice && 'border-destructive'
                          )}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cacheReadPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cache Read ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className={cn(
                            formErrors.cacheReadPrice && 'border-destructive'
                          )}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cacheWritePrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cache Write ($)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className={cn(
                            formErrors.cacheWritePrice && 'border-destructive'
                          )}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

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
                {loading ? 'Saving...' : 'Save Changes'}
              </ButtonWithFeedback>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
