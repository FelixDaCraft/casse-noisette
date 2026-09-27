'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { login } from '../actions';

export default function LoginForm({ resetDone }: { resetDone?: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <>
      <h2>Connexion</h2>
      <p className="sous">Accès réservé aux responsables collage.</p>
      {resetDone && <p className="succes" style={{ marginBottom: 16 }}>Mot de passe modifié. Tu peux te connecter.</p>}
      <form action={action}>
        <label className="champ">
          Email
          <input name="email" type="email" autoComplete="username" placeholder="prenom@exemple.fr" required />
        </label>
        <label className="champ">
          Mot de passe
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {state?.error && <p className="erreur">{state.error}</p>}
        <button className="btn-auth" disabled={pending}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <Link href="/admin/forgot" className="lien-sobre">
        Mot de passe oublié ?
      </Link>
    </>
  );
}
