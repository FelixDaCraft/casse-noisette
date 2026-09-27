/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Permet de vérifier un build sans écraser le .next d'un `next dev` en cours
  // (ce qui casse le serveur de dev en pleine session) :
  //   NEXT_DIST_DIR=.next-verif npm run build
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Le service worker ne doit pas être mis en cache agressivement.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default nextConfig;
