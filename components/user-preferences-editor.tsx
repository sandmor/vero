'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from '@/components/toast';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import type { UserPreferences } from '@/lib/db/schema';

export function UserPreferencesEditor() {
  const router = useRouter();
  const [name, setName] = useState<string>('');
  const [occupation, setOccupation] = useState<string>('');
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Load existing preferences
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/user/preferences');
        if (response.ok) {
          const data = await response.json();
          const preferences = data.preferences as UserPreferences | null;
          if (preferences) {
            setName(preferences.name || '');
            setOccupation(preferences.occupation || '');
            setCustomInstructions(preferences.customInstructions || '');
          }
        }
      } catch (error) {
        console.error('Failed to load user preferences:', error);
        toast({
          type: 'error',
          description: 'Failed to load preferences',
        });
      } finally {
        setIsLoading(false);
      }
    };
    loadPreferences();
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (preferences: UserPreferences) => {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to save preferences');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        type: 'success',
        description: 'Preferences saved successfully',
      });
      router.refresh();
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to save preferences',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/user/preferences', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to clear preferences');
      }

      return response.json();
    },
    onSuccess: () => {
      setName('');
      setOccupation('');
      setCustomInstructions('');
      toast({
        type: 'success',
        description: 'Preferences cleared successfully',
      });
      router.refresh();
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to clear preferences',
      });
    },
  });

  const handleSave = async () => {
    const preferences: UserPreferences = {
      ...(name.trim() && { name: name.trim() }),
      ...(occupation.trim() && { occupation: occupation.trim() }),
      ...(customInstructions.trim() && {
        customInstructions: customInstructions.trim(),
      }),
    };

    try {
      await saveMutation.mutateAsync(preferences);
    } catch {
      // Error handled in onError
    }
  };

  const handleClear = async () => {
    try {
      await deleteMutation.mutateAsync();
    } catch {
      // Error handled in onError
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-4 text-sm text-muted-foreground">
        Personalize your AI assistant by providing your name, occupation, and
        custom instructions. These preferences will be used to tailor responses
        to your specific needs and context.
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1] }}
      >
        <Card className="border-border/60 bg-card/40 backdrop-blur">
          <CardHeader>
            <CardTitle>User Profile</CardTitle>
            <CardDescription>
              Basic information about you that helps personalize the AI
              responses
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                How you'd like the AI to address you
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="occupation">Occupation</Label>
              <Input
                id="occupation"
                placeholder="Your occupation or role"
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Helps the AI understand your background and expertise
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customInstructions">Custom Instructions</Label>
              <Textarea
                id="customInstructions"
                placeholder="Any specific instructions for how the AI should interact with you..."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Specific preferences for AI behavior, communication style, or
                context
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex-1"
              >
                <motion.div
                  whileTap={{ scale: 0.97 }}
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                  }}
                  className="flex items-center gap-2"
                >
                  <AnimatedButtonLabel
                    state={saveMutation.isPending ? 'loading' : 'idle'}
                    idleLabel="Save Preferences"
                    loadingLabel="Saving..."
                  />
                </motion.div>
              </Button>

              <Button
                variant="outline"
                onClick={handleClear}
                disabled={
                  deleteMutation.isPending ||
                  (!name && !occupation && !customInstructions)
                }
              >
                <motion.div
                  whileTap={{ scale: 0.97 }}
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                  }}
                  className="flex items-center gap-2"
                >
                  <AnimatedButtonLabel
                    state={deleteMutation.isPending ? 'loading' : 'idle'}
                    idleLabel="Clear All"
                    loadingLabel="Clearing..."
                  />
                </motion.div>
              </Button>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/50 p-4">
              <h4 className="mb-2 text-sm font-medium">
                Available Prompt Variables
              </h4>
              <div className="space-y-1 text-xs text-muted-foreground">
                <code className="rounded bg-background px-1 py-0.5">
                  {'{{userName}}'}
                </code>
                <span className="ml-2">- Your name</span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <code className="rounded bg-background px-1 py-0.5">
                  {'{{userOccupation}}'}
                </code>
                <span className="ml-2">- Your occupation</span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <code className="rounded bg-background px-1 py-0.5">
                  {'{{userCustomInstructions}}'}
                </code>
                <span className="ml-2">- Your custom instructions</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
