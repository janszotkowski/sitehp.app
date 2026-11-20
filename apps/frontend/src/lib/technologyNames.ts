import type { Technology } from '@sitehp.app/core/browser';

/** Product names, written the way their makers write them, so they are not translated. Typed on `Technology`, so a new one without a name fails the build. */
export const technologyNames: Record<Technology, string> = {
    wordpress: 'WordPress',
    shopify: 'Shopify',
    nextjs: 'Next.js',
    nuxt: 'Nuxt',
    wix: 'Wix',
    squarespace: 'Squarespace',
    webflow: 'Webflow',
    drupal: 'Drupal',
    joomla: 'Joomla',
    cloudflare: 'Cloudflare',
    vercel: 'Vercel',
    netlify: 'Netlify',
    nginx: 'nginx',
    apache: 'Apache',
};
