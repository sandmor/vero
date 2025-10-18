'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CircleAlert, Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/toast';

type FeedbackState = 'idle' | 'saved' | 'error';

interface SettingConfig {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'text';
  defaultValue: string;
  validation?: (value: string) => string | null;
}

const SETTING_CONFIGS: SettingConfig[] = [
  {
    key: 'maxMessageLength',
    label: 'Maximum Message Length',
    description: 'Maximum number of characters allowed in a single message',
    type: 'number',
    defaultValue: '16000',
    validation: (value: string) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 100000) {
        return 'Must be a number between 1 and 100,000';
      }
      return null;
    },
  },
  {
    key: 'maxOutputTokens',
    label: 'Maximum Output Tokens',
    description: 'Maximum number of tokens to generate in a single response',
    type: 'number',
    defaultValue: '4096',
    validation: (value: string) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 100000) {
        return 'Must be a number between 1 and 100,000';
      }
      return null;
    },
  },
];

export function SettingsEditor({
  initialSettings,
}: {
  initialSettings: Record<string, string>;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    for (const config of SETTING_CONFIGS) {
      result[config.key] = initialSettings[config.key] || config.defaultValue;
    }
    return result;
  });
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>(() =>
    Object.fromEntries(SETTING_CONFIGS.map((config) => [config.key, 'idle']))
  );
  const feedbackTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(feedbackTimers.current).forEach((timer) =>
        window.clearTimeout(timer)
      );
    };
  }, []);

  const setFeedbackState = (id: string, state: FeedbackState, ttl = 1600) => {
    setFeedback((prev) => ({ ...prev, [id]: state }));
    if (state === 'idle') return;
    if (feedbackTimers.current[id]) {
      window.clearTimeout(feedbackTimers.current[id]);
    }
    feedbackTimers.current[id] = window.setTimeout(() => {
      setFeedback((prev) => ({ ...prev, [id]: 'idle' }));
      delete feedbackTimers.current[id];
    }, ttl);
  };

  const saveMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const response = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to save setting');
      }

      return { id };
    },
    onSuccess: (_, variables) => {
      toast({
        type: 'success',
        description: `${SETTING_CONFIGS.find((c) => c.key === variables.id)?.label || variables.id} saved`,
      });
      setFeedbackState(variables.id, 'saved');
      router.refresh();
    },
    onError: (error, variables) => {
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : `Failed to save ${SETTING_CONFIGS.find((c) => c.key === variables.id)?.label || variables.id}`,
      });
      setFeedbackState(variables.id, 'error', 2200);
    },
  });

  const handleSave = (key: string) => {
    const config = SETTING_CONFIGS.find((c) => c.key === key);
    if (!config) return;

    const value = settings[key];
    const validationError = config.validation?.(value);
    if (validationError) {
      toast({
        type: 'error',
        description: validationError,
      });
      return;
    }

    saveMutation.mutate({ id: key, value });
  };

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      {SETTING_CONFIGS.map((config) => (
        <div key={config.key} className="space-y-2">
          <Label htmlFor={config.key} className="text-sm font-medium">
            {config.label}
          </Label>
          <p className="text-xs text-muted-foreground">{config.description}</p>
          <div className="flex items-center gap-2">
            <Input
              id={config.key}
              type={config.type}
              value={settings[config.key]}
              onChange={(e) => handleChange(config.key, e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={() => handleSave(config.key)}
              disabled={saveMutation.isPending}
              className="shrink-0"
            >
              <AnimatePresence mode="wait">
                {saveMutation.isPending &&
                saveMutation.variables?.id === config.key ? (
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
                ) : feedback[config.key] === 'saved' ? (
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
                ) : feedback[config.key] === 'error' ? (
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
                    className="flex items-center gap-2"
                  >
                    <Save className="h-4 w-4" />
                    Save
                  </motion.div>
                )}
              </AnimatePresence>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
