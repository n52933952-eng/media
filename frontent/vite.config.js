import fs from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envDir = path.resolve(__dirname, '..')

/** SEO: OG/Twitter/canonical + sitemap/robots when VITE_PUBLIC_SITE_URL is set (e.g. https://yourdomain.com). Safe if unset. */
function playsocialSeoPlugin(siteUrl) {
  const base = (siteUrl || '').trim().replace(/\/$/, '')
  const desc =
    'playsocial — social feed, messages, games, and calls. Connect with friends and play chess, Go Fish, and more.'

  return {
    name: 'playsocial-seo',
    transformIndexHtml(html) {
      if (!base) {
        return html
          .replace(/%CANONICAL_LINK%/g, '')
          .replace(/%OG_TAGS%/g, '')
          .replace(/%TWITTER_TAGS%/g, '')
          .replace(/%JSON_LD%/g, '')
      }
      const ogImage = `${base}/playsocial-icon.png`
      const canonicalLink = `<link rel="canonical" href="${base}/" />`
      const og = `
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${base}/" />
    <meta property="og:title" content="playsocial" />
    <meta property="og:description" content="${desc.replace(/"/g, '&quot;')}" />
    <meta property="og:image" content="${ogImage}" />
    <meta property="og:locale" content="en_US" />`
      const twitter = `
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="playsocial" />
    <meta name="twitter:description" content="${desc.replace(/"/g, '&quot;')}" />
    <meta name="twitter:image" content="${ogImage}" />`
      const jsonLd = `
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'playsocial',
      url: `${base}/`,
      description: 'Social feed, messages, games, and calls.',
    })}</script>`
      return html
        .replace(/%CANONICAL_LINK%/g, canonicalLink)
        .replace(/%OG_TAGS%/g, og)
        .replace(/%TWITTER_TAGS%/g, twitter)
        .replace(/%JSON_LD%/g, jsonLd)
    },
    closeBundle() {
      if (!base) return
      const outDir = path.resolve(__dirname, 'dist')
      const urls = ['/', '/welcome', '/about', '/privacy', '/terms', '/sign']
      const today = new Date().toISOString().slice(0, 10)
      const body = urls
        .map((p) => {
          const priority =
            p === '/' ? '1.0' : p === '/welcome' ? '0.9' : p === '/about' ? '0.85' : '0.6'
          const changefreq = p === '/' || p === '/welcome' || p === '/about' ? 'weekly' : 'monthly'
          return `  <url>\n    <loc>${base}${p}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
        })
        .join('\n')
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
      try {
        fs.writeFileSync(path.join(outDir, 'sitemap.xml'), xml, 'utf8')
        fs.writeFileSync(
          path.join(outDir, 'robots.txt'),
          `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`,
          'utf8'
        )
      } catch (e) {
        console.warn('[playsocial-seo] Could not write sitemap.xml / robots.txt:', e?.message || e)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')
  const siteUrl = env.VITE_PUBLIC_SITE_URL || ''

  return {
    envDir,
    base: '/',
    plugins: [react(), nodePolyfills(), playsocialSeoPlugin(siteUrl)],
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      include: ['buffer'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'chakra-ui': ['@chakra-ui/react', '@emotion/react', '@emotion/styled', 'framer-motion'],
            'socket-vendor': ['socket.io-client', 'simple-peer'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
  }
})
