'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { requestReset } from '../actions';

export default function ForgotForm() {
  const [state, action, pending] = useActionState(requestReset, undefined);
  return (
    <>
      <h2>Mot de passe oublié</h2>
      <p className="sous">
        Entre ton email : tu recevras un lien pour choisir un nouveau mot de passe (valable 1 h).
      </p>
      <form action={action}>
        <label className="champ">
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        {state?.error && <p className="erreur">{state.error}</p>}
        {state?.ok && <p className="succes">{state.ok}</p>}
        <button className="btn-auth" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer le lien'}
        </button>
      </form>
      <Link href="/admin/login" className="lien-sobre" style={{ textDecoration: 'none' }}>
        ← Retour à la connexion
      </Link>
    </>
  );
}
