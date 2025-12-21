'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
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
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/toast';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { ByokManager } from '@/components/byok-manager';
import { DataExportImport } from '@/components/data-export-import';
import type { UserPreferences } from '@/lib/db/schema';

export function UserPreferencesEditor() {
  const router = useRouter();
  const [name, setName] = useState<string>('');
  const [occupation, setOccupation] = useState<string>('');
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [isProfileLoading, setIsProfileLoading] = useState<boolean>(true);

  // Load preferences
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
        console.error('Failed to load preferences:', error);
        toast({
          type: 'error',
          description: 'Failed to load preferences',
        });
      } finally {
        setIsProfileLoading(false);
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

  if (isProfileLoading) {
    return (
      <div className="space-y-10 px-2 py-6 w-full animate-in fade-in-0 slide-in-from-bottom-4">
        {/* Profile skeleton */}
        <div className="rounded-3xl border border-border/60 bg-card/40 p-6 shadow-sm backdrop-blur">
          <div className="mb-2">
            <Skeleton className="h-6 w-40" />
            <div className="mt-2">
              <Skeleton className="h-4 w-72" />
            </div>
          </div>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-4 w-40" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-4 w-40" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-4 w-56" />
            </div>

            <div className="flex gap-2 pt-4">
              <Skeleton className="h-10 w-1/2 rounded-lg" />
              <Skeleton className="h-10 w-1/4 rounded-lg" />
            </div>
          </div>
        </div>

        {/* BYOK skeleton */}
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-10 px-2 py-6 w-full animate-in fade-in-0 slide-in-from-bottom-4">
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
        <Card className="border-border/40 bg-card/50 backdrop-blur shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-bold tracking-tight">
              User Profile
            </CardTitle>
            <CardDescription>
              Basic information about you that helps personalize the AI
              responses
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background/50 border-border/40 focus-visible:ring-primary/20"
              />
              <p className="text-[11px] text-muted-foreground/80">
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
                className="bg-background/50 border-border/40 focus-visible:ring-primary/20"
              />
              <p className="text-[11px] text-muted-foreground/80">
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
                className="bg-background/50 border-border/40 focus-visible:ring-primary/20"
              />
              <p className="text-[11px] text-muted-foreground/80">
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
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1], delay: 0.1 }}
      >
        <ByokManager />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1], delay: 0.2 }}
      >
        <DataExportImport />
      </motion.div>
    </div>
  );
}
