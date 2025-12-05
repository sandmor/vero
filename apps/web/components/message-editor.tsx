'use client';

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ChatMessage } from '@/lib/types';
import { getTextFromMessage } from '@/lib/utils';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { toast } from './toast';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type MessageEditorProps = {
  message: ChatMessage;
  setMode: Dispatch<SetStateAction<'view' | 'edit'>>;
  onSubmit: (nextText: string) => Promise<void>;
  onSubmitWithoutRegenerate?: (nextText: string) => Promise<void>;
};

export function MessageEditor({
  message,
  setMode,
  onSubmit,
  onSubmitWithoutRegenerate,
}: MessageEditorProps) {
  const [submittingType, setSubmittingType] = useState<'save' | 'send' | null>(
    null
  );

  const [draftContent, setDraftContent] = useState<string>(
    getTextFromMessage(message)
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };
  return (
    <div className="flex w-full flex-col gap-2">
      <Textarea
        className="w-full resize-none overflow-hidden rounded-xl bg-transparent text-base! outline-hidden"
        data-testid="message-editor"
        onChange={handleInput}
        ref={textareaRef}
        value={draftContent}
      />

      <div className="flex flex-row justify-end gap-3">
        <Button
          className="h-9 px-4 py-2"
          onClick={() => {
            setMode('view');
          }}
          variant="outline"
        >
          Cancel
        </Button>
        <div className="inline-flex items-center rounded-md shadow-sm">
          <Button
            className={cn(
              'h-9 rounded-r-none border-r-0 px-4 py-2 focus:z-10',
              onSubmitWithoutRegenerate ? 'rounded-r-none' : ''
            )}
            data-testid="message-editor-send-button"
            disabled={submittingType !== null}
            onClick={async () => {
              const trimmed = draftContent.trim();
              if (!trimmed) {
                toast({
                  type: 'error',
                  description: 'Message cannot be empty.',
                });
                return;
              }

              setSubmittingType('send');
              setMode('view');
              try {
                await onSubmit(trimmed);
              } catch (err) {
                console.error('Edit failed', err);
                setMode('edit');
              } finally {
                setSubmittingType(null);
              }
            }}
            variant="default"
          >
            {submittingType === 'send' ? 'Sending...' : 'Submit'}
          </Button>
          {onSubmitWithoutRegenerate && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="h-9 rounded-l-none border-l border-primary-foreground/20 px-2 py-2"
                  disabled={submittingType !== null}
                  variant="default"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={async () => {
                    const trimmed = draftContent.trim();
                    if (!trimmed) {
                      toast({
                        type: 'error',
                        description: 'Message cannot be empty.',
                      });
                      return;
                    }

                    setSubmittingType('save');
                    try {
                      await onSubmitWithoutRegenerate(trimmed);
                      setMode('view');
                    } catch (err) {
                      console.error('Edit failed', err);
                    } finally {
                      setSubmittingType(null);
                    }
                  }}
                >
                  Update Text Only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}
