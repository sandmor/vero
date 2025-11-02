export type UserType = 'guest' | 'regular';

export type SessionUser = {
  id: string;
  type: UserType;
  email?: string | null;
};

export type AppSession = {
  user: SessionUser;
};
