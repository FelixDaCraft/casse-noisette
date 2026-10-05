import Marque, { DuoVioletDef } from '../Marque';

/**
 * Mise en page commune aux écrans hors session : bloc violet de présentation à
 * gauche, formulaire à droite. Les trois écrans (connexion, mot de passe
 * oublié, nouveau mot de passe) ne diffèrent que par leur formulaire. La
 * connexion militante reprend la même mise en page avec son propre texte.
 */
export default function AuthShell({
  children,
  titre,
  texte,
  pied,
}: {
  children: React.ReactNode;
  titre?: React.ReactNode;
  texte?: React.ReactNode;
  pied?: React.ReactNode;
}) {
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
            {titre ?? (
              <>
                Back<em>office</em>
              </>
            )}
          </h1>
          <p className="prose">
            {texte ??
              'Prépare les tournées de collage, département par département : communes, circonscriptions, panneaux, ordre de passage.'}
          </p>
        </div>
        <span className="auth-circo">{pied ?? 'Toute la France · métropole et outre-mer'}</span>
      </div>
      <div className="auth-droite">
        <div className="auth-form">{children}</div>
      </div>
    </div>
  );
}
