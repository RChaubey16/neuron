import type { MetadataRoute } from 'next';

// Only the landing page is public content. The dashboard renders nothing
// without a session token, and /auth/callback is a transient redirect page,
// so keep crawlers out of both.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/auth'],
    },
  };
}
