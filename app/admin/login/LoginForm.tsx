'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { login } from '../actions';

export default function LoginForm({ resetDone }: { resetDone?: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="login-card">
      <h1 style={{ fontSize: '1.5rem', margin: '0 0 .8em' }}>φ Backoffice</h1>
      {resetDone && <p className="ok">Mot de passe modifié. Tu peux te connecter.</p>}
      <label className="fld" htmlFor="email">
        Email
      </label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <div style={{ height: 12 }} />
      <label className="fld" htmlFor="password">
        Mot de passe
      </label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      {state?.error && <p className="err">{state.error}</p>}
      <div style={{ height: 16 }} />
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
        {pending ? 'Connexion…' : 'Se connecter'}
      </button>
      <p style={{ marginTop: 14 }}>
        <Link href="/admin/forgot" className="muted">Mot de passe oublié ?</Link>
      </p>
    </form>
  );
}
