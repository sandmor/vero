import { Bot } from 'lucide-react';
import { LogoOpenAI, LogoGoogle, LogoOpenRouter } from '@/components/icons';

export function ProviderLogo({
  providerId,
  className,
}: {
  providerId: string;
  className?: string;
}) {
  switch (providerId) {
    case 'openai':
      return <LogoOpenAI size={24} />;
    case 'google':
      return <LogoGoogle size={24} />;
    case 'openrouter':
      return <LogoOpenRouter size={24} />;
    default:
      return <Bot className={className} />;
  }
}
