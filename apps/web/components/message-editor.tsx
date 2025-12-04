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

      <div className="flex flex-row justify-end gap-2">
        <Button
          className="h-fit px-3 py-2"
          onClick={() => {
            setMode('view');
          }}
          variant="outline"
        >
          Cancel
        </Button>
        {onSubmitWithoutRegenerate && (
          <Button
            className="h-fit px-3 py-2"
            data-testid="message-editor-save-only-button"
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

              setSubmittingType('save');
              try {
                await onSubmitWithoutRegenerate(trimmed);
                setMode('view');
              } catch (err) {
                console.error('Edit failed', err);
                // Stay in edit mode on failure
              } finally {
                setSubmittingType(null);
              }
            }}
            variant="secondary"
          >
            {submittingType === 'save' ? 'Saving...' : 'Save only'}
          </Button>
        )}
        <Button
          className="h-fit px-3 py-2"
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
              setMode('edit'); // Re-enable edit mode on failure
            } finally {
              setSubmittingType(null);
            }
          }}
          variant="default"
        >
          {submittingType === 'send' ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
