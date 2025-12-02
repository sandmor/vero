import { connection } from 'next/server';
import { LoginForm } from './login-form';

export default async function Page() {
  await connection();

  return <LoginForm />;
}
