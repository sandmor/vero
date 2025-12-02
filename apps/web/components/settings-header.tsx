'use client';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigationStore } from '@/lib/navigation-store';

export default function SettingsHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const router = useRouter();
  const lastChatUrl = useNavigationStore((state) => state.lastChatUrl);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="flex items-start justify-between gap-4"
    >
      <div className="flex-1 min-w-0">
        <h1
          id="settings-heading"
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight"
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      <div className="shrink-0">
        <motion.div whileTap={{ scale: 0.95 }}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const targetUrl = lastChatUrl || '/chat';
              router.push(targetUrl);
            }}
          >
            <ArrowLeft size={16} />
            <span className="sr-only md:not-sr-only md:ml-2">Back</span>
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
