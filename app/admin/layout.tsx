import Link from 'next/link';
import { getCurrentAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logout } from './actions';
import Marque, { DuoVioletDef } from '../Marque';
import NavAdmin from './NavAdmin';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();

  // Hors session (connexion, mot de passe oublié), pas de barre latérale :
  // ces écrans ont leur propre mise en page en deux colonnes.
  if (!admin) return <>{children}</>;

  const [tournees, panneaux, admins] = await Promise.all([
    prisma.itinerary.count(),
    prisma.panel.count(),
    prisma.admin.count(),
  ]);

  return (
    <div className="admin-shell">
      <DuoVioletDef />
      <aside className="sidebar">
        <div className="sidebar-marque">
          <Marque size={38} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="nom">Casse-Noisette</span>
            <span className="sous">Backoffice</span>
          </div>
        </div>

        <NavAdmin compteurs={{ tournees, panneaux, admins }} />

        <div className="sidebar-pied">
          <span className="sidebar-moi">{admin.email}</span>
          <form action={logout}>
            <button className="btn-contour">Déconnexion</button>
          </form>
        </div>
      </aside>

      <main className="admin-main">{children}</main>
    </div>
  );
}
