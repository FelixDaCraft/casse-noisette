import Link from 'next/link';
import Avatar from './Avatar';

const IconPodium = (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 21V9h6v12" />
    <path d="M3 21v-7h6" />
    <path d="M15 21v-5h6v5" />
    <path d="M2 21h20" />
    <path d="m12 3 .9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.1l2-.3z" />
  </svg>
);

/** Coin droit du bandeau : le classement, puis l'avatar qui mène au profil. */
export default function HdMoi({ nom, image }: { nom: string; image: string | null }) {
  return (
    <>
      <Link href="/classement" className="hd-classement" title="Classement">
        {IconPodium}
        <span className="sr">Classement</span>
      </Link>
      <Link href="/profil" className="hd-moi" title="Mon profil">
        <Avatar nom={nom} image={image} className="avatar avatar-sm" />
        <span className="sr">Mon profil</span>
      </Link>
    </>
  );
}
