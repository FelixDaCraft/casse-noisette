'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MILITANT_COOKIE } from '@/lib/auth';

export async function deconnexion() {
  const store = await cookies();
  store.delete(MILITANT_COOKIE);
  redirect('/connexion?sortie=1');
}
