import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import AdminsManager from './AdminsManager';

export const dynamic = 'force-dynamic';

export default async function AdminsPage() {
  const me = await requireAdmin();
  const admins = await prisma.admin.findMany({ orderBy: { createdAt: 'asc' } });
  return (
    <AdminsManager
      meId={me.id}
      admins={admins.map((a) => ({ id: a.id, email: a.email, active: a.active }))}
    />
  );
}
