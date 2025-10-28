/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    server: {
      deps: {
        inline: ['server-only'],
      },
    },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['node_modules', 'lib/ai/__tests__'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, './test/mocks/server-only.ts'),
      'next/navigation': path.resolve(
        __dirname,
        './test/mocks/next-navigation.ts'
      ),
      'next/navigation.js': path.resolve(
        __dirname,
        './test/mocks/next-navigation.ts'
      ),
      'bun:test': 'vitest',
    },
  },
});
