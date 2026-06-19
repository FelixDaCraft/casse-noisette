'use client';
import { useActionState } from 'react';
import { performReset } from '../actions';

export default function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(performReset, undefined);
  return (
    <form action={action} className="login-card">
      <input type="hidden" name="token" value={token} />
      <h1 style={{ fontSize: '1.4rem', margin: '0 0 .8em' }}>Nouveau mot de passe</h1>
      <label className="fld" htmlFor="password">Nouveau mot de passe (8 caractères min.)</label>
      <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      <div style={{ height: 12 }} />
      <label className="fld" htmlFor="confirm">Confirmer</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      {state?.error && <p className="err">{state.error}</p>}
      <div style={{ height: 16 }} />
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
        {pending ? 'Enregistrement…' : 'Changer le mot de passe'}
      </button>
    </form>
  );
}
