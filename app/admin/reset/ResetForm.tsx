'use client';
import { useActionState } from 'react';
import { performReset } from '../actions';

export default function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(performReset, undefined);
  return (
    <>
      <h2>Nouveau mot de passe</h2>
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <label className="champ">
          Nouveau mot de passe <span className="aide">8 caractères minimum</span>
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        <label className="champ">
          Confirmer
          <input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        {state?.error && <p className="erreur">{state.error}</p>}
        <button className="btn-auth" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Changer le mot de passe'}
        </button>
      </form>
    </>
  );
}
