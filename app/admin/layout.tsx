import Link from 'next/link';
import { getCurrentAdmin } from '@/lib/auth';
import { logout } from './actions';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();
  return (
    <>
      <div className="bg" />
      {admin && (
        <nav className="admin-nav">
          <span className="brand">φ Backoffice</span>
          <Link href="/admin">Itinéraires</Link>
          <Link href="/admin/admins">Admins</Link>
          <Link href="/">Voir le site</Link>
          <span className="spacer" />
          <span className="muted">{admin.email}</span>
          <form action={logout}>
            <button className="btn sm">Déconnexion</button>
          </form>
        </nav>
      )}
      <main className="admin-main">{children}</main>
    </>
  );
}
