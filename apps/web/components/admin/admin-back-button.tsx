'use client';

import { useRouter } from 'next/navigation';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import { ArrowLeft } from 'lucide-react';

export function AdminBackButton() {
  const router = useRouter();

  return (
    <ButtonWithFeedback
      variant="outline"
      size="sm"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push('/chat');
        }
      }}
    >
      <ArrowLeft size={16} />
      <span className="sr-only md:not-sr-only md:ml-2">Back</span>
    </ButtonWithFeedback>
  );
}
