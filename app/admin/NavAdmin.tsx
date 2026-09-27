'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Navigation de la barre latérale : l'entrée courante est sur fond crème. */
export default function NavAdmin({
  compteurs,
}: {
  compteurs: { tournees: number; panneaux: number; admins: number };
}) {
  const ici = usePathname();
  const liens = [
    { href: '/admin', label: 'Tournées', compte: compteurs.tournees, exact: true },
    { href: '/admin/panels', label: 'Panneaux', compte: compteurs.panneaux },
    { href: '/admin/admins', label: 'Comptes admin', compte: compteurs.admins },
  ];

  return (
    <nav>
      {liens.map((l) => {
        const actif = l.exact ? ici === l.href : ici.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={'nav-item' + (actif ? ' actif' : '')}>
            {l.label}
            <span className="nav-cnt">{l.compte}</span>
          </Link>
        );
      })}
      <a className="nav-item" href="/" style={{ opacity: 0.85 }}>
        Voir le site<span style={{ fontSize: 14 }}>↗</span>
      </a>
    </nav>
  );
}
