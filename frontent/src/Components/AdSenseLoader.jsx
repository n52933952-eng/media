import { useEffect } from 'react'

/**
 * Loads the AdSense script only when VITE_ADSENSE_CLIENT is set (e.g. ca-pub-xxxxxxxxxxxxxxxx).
 * If unset, this component does nothing — no impact on the rest of the app.
 */
export default function AdSenseLoader() {
  const client = import.meta.env.VITE_ADSENSE_CLIENT

  useEffect(() => {
    if (!client || typeof document === 'undefined') return
    // Do not load AdSense on local dev unless you explicitly allow it (avoids console noise / policy issues).
    if (import.meta.env.DEV && import.meta.env.VITE_ADSENSE_ALLOW_DEV !== 'true') return
    if (document.querySelector('script[data-playsocial-adsense]')) return

    const s = document.createElement('script')
    s.async = true
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`
    s.crossOrigin = 'anonymous'
    s.dataset.playsocialAdsense = '1'
    document.head.appendChild(s)
  }, [client])

  return null
}
