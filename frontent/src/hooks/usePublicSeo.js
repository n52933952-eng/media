import { useEffect } from 'react'

const SITE_ORIGIN = 'https://playsocial.social'

const upsertMeta = (name, content) => {
  if (!content) return null
  let tag = document.head.querySelector(`meta[name="${name}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute('name', name)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
  return tag
}

export function usePublicSeo({ title, description, path }) {
  useEffect(() => {
    const prevTitle = document.title
    const canonicalHref = `${SITE_ORIGIN}${path}`
    document.title = title

    let canonical = document.head.querySelector('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.setAttribute('rel', 'canonical')
      document.head.appendChild(canonical)
    }
    canonical.setAttribute('href', canonicalHref)

    const descTag = upsertMeta('description', description)

    return () => {
      document.title = prevTitle
      if (descTag) descTag.setAttribute('content', '')
    }
  }, [title, description, path])
}

