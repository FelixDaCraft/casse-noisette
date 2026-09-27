'use client';
import { useActionState, useState, useTransition } from 'react';
import { createAdmin, toggleAdmin, deleteAdmin } from '../actions';
import Confirm from '../Confirm';

type A = { id: string; email: string; active: boolean };

export default function AdminsManager({ meId, admins }: { meId: string; admins: A[] }) {
  const [state, action, pending] = useActionState(createAdmin, undefined);
  const [busy, start] = useTransition();
  const [aSupprimer, setASupprimer] = useState<A | null>(null);

  return (
    <div className="admin-large">
      <div className="page-tete">
        <div>
          <div className="admin-kicker">
            {admins.length} compte{admins.length > 1 ? 's' : ''}
          </div>
          <h1 className="admin-h1">Comptes admin</h1>
        </div>
      </div>
      <p className="admin-intro prose">
        Les comptes admin peuvent créer et modifier les tournées. On ne peut ni se désactiver ni se
        supprimer soi-même.
      </p>

      <form action={action} className="carte-form">
        <label className="champ" style={{ flex: '2 1 240px' }}>
          Email
          <input name="email" type="email" required placeholder="prenom@exemple.fr" />
        </label>
        <label className="champ" style={{ flex: '1 1 200px' }}>
          Mot de passe <span className="aide">8 caractères minimum</span>
          <input name="password" type="password" required minLength={8} />
        </label>
        <button className="btn btn-violet" disabled={pending}>
          {pending ? 'Création…' : 'Créer le compte'}
        </button>
        {state?.error && <p className="erreur" style={{ flexBasis: '100%' }}>{state.error}</p>}
        {state?.ok && <p className="succes" style={{ flexBasis: '100%' }}>{state.ok}</p>}
      </form>

      <section className="groupe-admin">
        <h2>Comptes existants</h2>
        {admins.map((a) => (
          <div className="ligne" key={a.id}>
            <div className="ligne-txt">
              <span className="ligne-titre">
                {a.email} {a.id === meId && <span style={{ color: 'var(--gris)', fontWeight: 600 }}>(toi)</span>}
              </span>
            </div>
            <span className={'badge ' + (a.active ? 'vert' : 'neutre')}>
              {a.active ? 'Actif' : 'Désactivé'}
            </span>
            <button
              className="btn btn-sm"
              disabled={busy || a.id === meId}
              onClick={() => start(async () => { await toggleAdmin(a.id); })}
            >
              {a.active ? 'Désactiver' : 'Réactiver'}
            </button>
            <button
              className="btn-texte-danger"
              disabled={busy || a.id === meId}
              onClick={() => setASupprimer(a)}
            >
              Supprimer
            </button>
          </div>
        ))}
      </section>

      {aSupprimer && (
        <Confirm
          titre="Supprimer le compte"
          texte={`Le compte ${aSupprimer.email} sera supprimé. Cette personne perdra l'accès au backoffice.`}
          onAnnuler={() => setASupprimer(null)}
          onConfirmer={() => {
            const id = aSupprimer.id;
            setASupprimer(null);
            start(async () => {
              await deleteAdmin(id);
            });
          }}
        />
      )}
    </div>
  );
}
