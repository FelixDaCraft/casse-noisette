'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { requestReset } from '../actions';

export default function ForgotForm() {
  const [state, action, pending] = useActionState(requestReset, undefined);
  return (
    <form action={action} className="login-card">
      <h1 style={{ fontSize: '1.4rem', margin: '0 0 .5em' }}>Mot de passe oublié</h1>
      <p className="muted" style={{ fontSize: '.88rem', margin: '0 0 1em' }}>
        Entre ton email : tu recevras un lien pour choisir un nouveau mot de passe.
      </p>
      <label className="fld" htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      {state?.error && <p className="err">{state.error}</p>}
      {state?.ok && <p className="ok">{state.ok}</p>}
      <div style={{ height: 16 }} />
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
        {pending ? 'Envoi…' : 'Envoyer le lien'}
      </button>
      <p style={{ marginTop: 14 }}>
        <Link href="/admin/login" className="muted">← Retour à la connexion</Link>
      </p>
    </form>
  );
}
