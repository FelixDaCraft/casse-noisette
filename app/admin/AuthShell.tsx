import Marque, { DuoVioletDef } from '../Marque';

/**
 * Mise en page commune aux écrans hors session : bloc violet de présentation à
 * gauche, formulaire à droite. Les trois écrans (connexion, mot de passe
 * oublié, nouveau mot de passe) ne diffèrent que par leur formulaire.
 */
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <DuoVioletDef />
      <div className="auth-gauche">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Marque size={44} />
          <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            Casse-Noisette
          </span>
        </div>
        <div>
          <h1>
            Back<em>office</em>
          </h1>
          <p className="prose">
            Prépare les tournées de collage de l’agglomération nantaise : communes,
            circonscriptions, panneaux, ordre de passage.
          </p>
        </div>
        <span className="auth-circo">Agglomération nantaise · Loire-Atlantique</span>
      </div>
      <div className="auth-droite">
        <div className="auth-form">{children}</div>
      </div>
    </div>
  );
}
