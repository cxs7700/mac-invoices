/**
 * Makes the vendor submission link installable to a phone home screen.
 *
 * The manifest is built at runtime rather than shipped as a static file: the
 * link is per-vendor (`/submit/:token`), and the whole point is that the
 * vendor's home-screen icon reopens *their* link. A static `start_url` could
 * only point at a route that means nothing without a token.
 *
 * iOS ignores the manifest for Add to Home Screen — it captures whatever URL is
 * open and reads `apple-*` meta tags instead — which happens to give exactly
 * the behaviour we want, so both paths land on the vendor's own link.
 */

const MANIFEST_ID = 'submit-manifest'
const META_IDS = 'pwa-meta'

type Cleanup = () => void

function manifestFor(url: string, name: string) {
  return {
    name,
    short_name: name,
    // start_url and scope are the current link, so launching from the home
    // screen reopens this vendor's submission page directly.
    start_url: url,
    scope: url,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eef1f5',
    theme_color: '#1d5fb0',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      // `maskable` lets Android crop to its own icon shape without clipping the
      // glyph, instead of pasting the square onto a white plate.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

/**
 * Attach a manifest + the iOS meta tags for the current submission URL.
 * Returns a cleanup that removes them again — the landlord app shares this
 * origin and must not stay installable as "submit an invoice" after a
 * client-side navigation away.
 */
export function installManifest(name: string): Cleanup {
  if (typeof document === 'undefined') return () => {}

  const url = window.location.pathname
  const blob = new Blob([JSON.stringify(manifestFor(url, name))], { type: 'application/manifest+json' })
  const href = URL.createObjectURL(blob)

  const link = document.createElement('link')
  link.id = MANIFEST_ID
  link.rel = 'manifest'
  link.href = href
  document.head.appendChild(link)

  const metas = [
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    { name: 'apple-mobile-web-app-title', content: name },
    { name: 'mobile-web-app-capable', content: 'yes' },
  ].map(({ name: n, content }) => {
    const meta = document.createElement('meta')
    meta.setAttribute('data-owner', META_IDS)
    meta.name = n
    meta.content = content
    document.head.appendChild(meta)
    return meta
  })

  const touchIcon = document.createElement('link')
  touchIcon.setAttribute('data-owner', META_IDS)
  touchIcon.rel = 'apple-touch-icon'
  touchIcon.href = '/apple-touch-icon.png'
  document.head.appendChild(touchIcon)

  return () => {
    link.remove()
    touchIcon.remove()
    for (const meta of metas) meta.remove()
    // The blob would otherwise be pinned for the lifetime of the document.
    URL.revokeObjectURL(href)
  }
}

/**
 * Register the submission-link service worker (see public/sw.js).
 *
 * Deliberately not called from main.tsx: registering app-wide would put a
 * service worker in front of the landlord's authenticated app, which is the
 * thing this design avoids. Failure is non-fatal — an unregistered worker only
 * costs offline launch, never the ability to submit.
 */
export function registerSubmitServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  // A dev server serves no /sw.js, and registering one against Vite's module
  // graph only produces confusing caching during development.
  if (import.meta.env.DEV) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
