'use client';

import * as React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { Button, ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ButtonWithFeedbackProps extends ButtonProps {
  motionProps?: HTMLMotionProps<'div'>;
  wrapperClassName?: string;
}

export const ButtonWithFeedback = React.forwardRef<
  HTMLButtonElement,
  ButtonWithFeedbackProps
>(({ className, motionProps, wrapperClassName, ...props }, ref) => {
  return (
    <motion.div
      whileTap={{ scale: 0.95 }}
      className={cn('inline-block', wrapperClassName)}
      {...motionProps}
    >
      <Button ref={ref} className={className} {...props} />
    </motion.div>
  );
});
ButtonWithFeedback.displayName = 'ButtonWithFeedback';
