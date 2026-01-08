import * as React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps extends React.ComponentProps<'svg'> {
  size?: number;
  variant?: 'default' | 'glyph';
}

export function Logo({
  size = 32,
  variant = 'default',
  className,
  ...props
}: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      {...props}
    >
      <defs>
        <linearGradient
          id="viridGradient"
          x1="0"
          y1="0"
          x2="512"
          y2="512"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#0f766e" />
        </linearGradient>
      </defs>

      {variant === 'default' && (
        <path
          d="M0 128C0 57.3 57.3 0 128 0H384C454.7 0 512 57.3 512 128V512H128C57.3 512 0 454.7 0 384V128Z"
          fill="url(#viridGradient)"
        />
      )}

      <path
        d="M140 140 L256 380 L372 140"
        stroke={variant === 'default' ? '#FDF6E3' : 'url(#viridGradient)'}
        strokeWidth="80"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
