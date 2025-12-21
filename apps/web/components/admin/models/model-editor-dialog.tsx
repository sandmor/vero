'use client';

import { useEffect, useState } from 'react';
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
  ManagedModelCapabilities,
  ModelFormat,
} from '@/lib/ai/model-capabilities';

const formSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1, 'Name is required'),
  creator: z.string().min(1, 'Creator is required'),
  supportsTools: z.boolean(),
  supportedFormats: z.array(z.string()),
  maxOutputTokens: z.string().optional(),
});

type ModelFormValues = z.infer<typeof formSchema>;

type ModelEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ManagedModelCapabilities | null;
  onSave: (data: ModelFormValues) => Promise<void>;
};

const FORMAT_OPTIONS: { value: ModelFormat; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
  { value: 'file', label: 'File Analysis' },
];

export function ModelEditorDialog({
  open,
  onOpenChange,
  model,
  onSave,
}: ModelEditorDialogProps) {
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      id: '',
      name: '',
      creator: '',
      supportsTools: false,
      supportedFormats: ['text'],
      maxOutputTokens: '',
    },
    mode: 'onSubmit',
  });

  const formErrors = form.formState.errors;
  const hasErrors = Object.keys(formErrors).length > 0;

  useEffect(() => {
    if (model) {
      form.reset({
        id: model.id,
        name: model.name,
        creator: model.creator || '',
        supportsTools: model.supportsTools,
        supportedFormats: model.supportedFormats,
        maxOutputTokens: model.maxOutputTokens?.toString() || '',
      });
    } else {
      form.reset({
        id: '',
        name: '',
        creator: '',
        supportsTools: false,
        supportedFormats: ['text'],
        maxOutputTokens: '',
      });
    }
    setSubmitError(null);
  }, [model, form, open]); // Reset when dialog opens/closes or model changes

  const onSubmit = async (values: ModelFormValues) => {
    setLoading(true);
    setSubmitError(null);
    try {
      await onSave(values);
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to save model';
      setSubmitError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{model ? 'Edit Model' : 'Create Model'}</DialogTitle>
          <DialogDescription>
            {model
              ? 'Update the capabilities configuration for this model.'
              : 'Define a new model capability.'}
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

            <FormField
              control={form.control}
              name="id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Model ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="gpt-4"
                      className={cn(formErrors.id && 'border-destructive')}
                      {...field}
                      disabled={!!model}
                    />
                  </FormControl>
                  <FormDescription>
                    Unique identifier for code references.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="GPT-4 Turbo"
                      className={cn(formErrors.name && 'border-destructive')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="creator"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Creator / Organization</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. OpenAI"
                      className={cn(formErrors.creator && 'border-destructive')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="supportsTools"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Supports Tools</FormLabel>
                    <FormDescription>
                      Can this model use function calling/tools?
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="supportedFormats"
              render={() => (
                <FormItem>
                  <div className="mb-4">
                    <FormLabel className="text-base">Capabilities</FormLabel>
                    <FormDescription>
                      Select the formats this model can handle.
                    </FormDescription>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {FORMAT_OPTIONS.map((item) => (
                      <FormField
                        key={item.value}
                        control={form.control}
                        name="supportedFormats"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={item.value}
                              className="flex flex-row items-start space-x-3 space-y-0"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(item.value)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([
                                          ...field.value,
                                          item.value,
                                        ])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value !== item.value
                                          )
                                        );
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal capitalize">
                                {item.label}
                              </FormLabel>
                            </FormItem>
                          );
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="maxOutputTokens"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Maximum Output Tokens</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="e.g. 8192" {...field} />
                  </FormControl>
                  <FormDescription>
                    Override the default max output tokens. Leave empty to use
                    the provider&apos;s default.
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
                {loading ? 'Saving...' : 'Save Changes'}
              </ButtonWithFeedback>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
