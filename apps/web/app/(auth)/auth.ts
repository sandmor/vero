// Legacy NextAuth file neutralized after migration to Clerk + custom session.
// Intentionally left minimal to avoid import errors during incremental refactor.
export const auth = async () => null;
export const signIn = async () => null;
export const signOut = async () => null;
export const handlers = {
  GET: () => new Response(null),
  POST: () => new Response(null),
};
export type UserType = 'guest' | 'regular';
