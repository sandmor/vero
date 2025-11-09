'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { Wand2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { useFeedbackState } from '@/hooks/use-feedback-state';

export function ChatRenameDialog({
  chat,
  open,
  onClose,
  onRename,
}: {
  chat: { id: string; title: string };
  open: boolean;
  onClose: () => void;
  onRename: (newTitle: string) => void;
}) {
  const [title, setTitle] = useState(chat.title);
  const [saveFeedback, setSaveFeedback] = useFeedbackState();
  const [generateFeedback, setGenerateFeedback] = useFeedbackState();

  const handleGenerateTitle = async () => {
    setGenerateFeedback('loading');
    try {
      const response = await fetch(`/chat/${chat.id}/api/generate-title`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || 'Failed to generate title';
        toast.error(errorMessage);
        setGenerateFeedback('error', 2200);
        return;
      }

      const { title: newTitle } = await response.json();
      setTitle(newTitle);
      setGenerateFeedback('success', 1200);
    } catch (error) {
      console.error('Failed to generate title', error);
      toast.error('Failed to generate title. Please try again.');
      setGenerateFeedback('error', 2200);
    }
  };

  const handleRename = async () => {
    setSaveFeedback('loading');
    try {
      // allow onRename to be async if parent chooses
      await Promise.resolve(onRename(title));
      setSaveFeedback('success', 900);
      onClose();
    } catch (error) {
      console.error('Failed to rename chat', error);
      toast.error('Failed to rename chat. Please try again.');
      setSaveFeedback('error', 2200);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Chat</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a new title"
            />
            <Button
              variant="outline"
              onClick={handleGenerateTitle}
              disabled={generateFeedback === 'loading'}
              aria-busy={generateFeedback === 'loading'}
            >
              <AnimatedButtonLabel
                state={generateFeedback}
                idleLabel="Generate with AI"
                loadingLabel="Generating..."
                successLabel="Generated"
                errorLabel="Error"
              />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleRename}
            disabled={generateFeedback === 'loading' || !title.trim()}
          >
            <AnimatedButtonLabel
              state={saveFeedback}
              idleLabel="Save"
              loadingLabel="Saving..."
              successLabel="Saved"
              errorLabel="Error"
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
