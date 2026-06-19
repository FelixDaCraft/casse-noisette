'use client';
import { useActionState, useTransition } from 'react';
import { createAdmin, toggleAdmin, deleteAdmin } from '../actions';

type A = { id: string; email: string; active: boolean };

export default function AdminsManager({ meId, admins }: { meId: string; admins: A[] }) {
  const [state, action, pending] = useActionState(createAdmin, undefined);
  const [busy, start] = useTransition();

  return (
    <>
      <h1>Comptes admin</h1>

      <form action={action} className="panel">
        <h2 style={{ marginTop: 0 }}>Nouvel admin</h2>
        <div className="row">
          <div className="grow">
            <label className="fld" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required />
          </div>
          <div className="grow">
            <label className="fld" htmlFor="password">Mot de passe (8+ caractères)</label>
            <input id="password" name="password" type="password" required minLength={8} />
          </div>
        </div>
        {state?.error && <p className="err">{state.error}</p>}
        {state?.ok && <p className="ok">{state.ok}</p>}
        <div style={{ height: 12 }} />
        <button className="btn primary" disabled={pending}>
          {pending ? 'Création…' : '+ Créer le compte'}
        </button>
      </form>

      <h2>Admins existants</h2>
      {admins.map((a) => (
        <div className="list-item" key={a.id}>
          <span className="title grow">
            {a.email} {a.id === meId && <span className="muted">(toi)</span>}
          </span>
          <span className="count">{a.active ? 'actif' : 'désactivé'}</span>
          <button
            className="btn sm"
            disabled={busy || a.id === meId}
            onClick={() => start(async () => { await toggleAdmin(a.id); })}
            title={a.active ? 'Désactiver' : 'Réactiver'}
          >
            {a.active ? 'Désactiver' : 'Réactiver'}
          </button>
          <button
            className="btn sm danger"
            disabled={busy || a.id === meId}
            onClick={() => {
              if (confirm(`Supprimer le compte ${a.email} ?`))
                start(async () => { await deleteAdmin(a.id); });
            }}
          >
            Suppr
          </button>
        </div>
      ))}
    </>
  );
}
