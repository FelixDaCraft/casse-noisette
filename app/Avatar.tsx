import { initiales } from '@/lib/militant';

/** Photo Action Populaire si elle existe, sinon les initiales sur fond violet. */
export default function Avatar({ nom, image, className = 'avatar' }: { nom: string; image?: string | null; className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" referrerPolicy="no-referrer" />
      ) : (
        initiales(nom)
      )}
    </span>
  );
}
