'use client';

import { useFormStatus } from 'react-dom';

import { Loader } from 'lucide-react';

import { Button } from './ui/button';

export function SubmitButton({
  children,
  isSuccessful,
}: {
  children: React.ReactNode;
  isSuccessful: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={pending || isSuccessful}
      className="relative"
      disabled={pending || isSuccessful}
      type={pending ? 'button' : 'submit'}
    >
      {children}

      {(pending || isSuccessful) && (
        <span className="absolute right-4 animate-spin">
          <Loader />
        </span>
      )}

      <output aria-live="polite" className="sr-only">
        {pending || isSuccessful ? 'Loading' : 'Submit form'}
      </output>
    </Button>
  );
}
