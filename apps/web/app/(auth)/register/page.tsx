'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSignUp } from '@clerk/nextjs';
import { AuthForm } from '@/components/auth-form';
import { SubmitButton } from '@/components/submit-button';
import { toast } from '@/components/toast';
import { SocialAuthButtons } from '@/components/social-auth-buttons';

export default function Page() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [isSuccessful, setIsSuccessful] = useState(false);

  const { isLoaded, signUp, setActive } = useSignUp();

  useEffect(() => {
    if (isSuccessful) {
      const timeout = setTimeout(() => router.push('/'), 400);
      return () => clearTimeout(timeout);
    }
  }, [isSuccessful, router]);

  const handleSubmit = async (formData: FormData) => {
    if (!isLoaded) return;
    const emailVal = formData.get('email') as string;
    const passwordVal = formData.get('password') as string;
    setEmail(emailVal);
    try {
      const result = await signUp.create({
        emailAddress: emailVal,
        password: passwordVal,
      });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        setIsSuccessful(true);
        toast({
          type: 'success',
          description: 'Account created successfully!',
        });
        router.refresh();
      } else if (result.status === 'missing_requirements') {
        toast({
          type: 'error',
          description: 'Additional verification required',
        });
      } else {
        toast({ type: 'error', description: 'Unexpected sign up state' });
      }
    } catch (e: any) {
      const raw = e?.errors?.[0]?.message || 'Failed to create account';
      const normalized = /exist/i.test(raw) ? 'Account already exists!' : raw;
      toast({ type: 'error', description: normalized });
    }
  };

  return (
    <div className="flex h-dvh w-screen items-start justify-center bg-background pt-12 md:items-center md:pt-0">
      <div className="flex w-full max-w-md flex-col gap-12 overflow-hidden rounded-2xl">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          <h3 className="font-semibold text-xl dark:text-zinc-50">Sign Up</h3>
          <p className="text-gray-500 text-sm dark:text-zinc-400">
            Create an account with your email and password
          </p>
        </div>
        <AuthForm action={handleSubmit} defaultEmail={email}>
          <SubmitButton isSuccessful={isSuccessful}>
            {isLoaded ? 'Sign Up' : 'Loading'}
          </SubmitButton>
          <SocialAuthDivider />
          <SocialAuthButtons mode="sign-up" />
          <p className="mt-4 text-center text-gray-600 text-sm dark:text-zinc-400">
            {'Already have an account? '}
            <Link
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200"
              href="/login"
            >
              Sign in
            </Link>
            {' instead.'}
          </p>
        </AuthForm>
      </div>
    </div>
  );
}

function SocialAuthDivider() {
  return (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-background px-2 text-muted-foreground">or</span>
      </div>
    </div>
  );
}
