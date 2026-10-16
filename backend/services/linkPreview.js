import dns from 'node:dns/promises'
import net from 'node:net'
import { parseVideoLink } from './videoLinks.js'

function isPrivateIp(ip) {
    const kind = net.isIP(ip)
    if (kind === 4) {
        const [a, b] = ip.split('.').map(Number)
        if (a === 10 || a === 127 || a === 0) return true
        if (a === 169 && b === 254) return true
        if (a === 192 && b === 168) return true
        if (a === 172 && b >= 16 && b <= 31) return true
        if (a === 100 && b >= 64 && b <= 127) return true
    }
    if (kind === 6) {
        const n = ip.toLowerCase()
        if (n === '::1' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80')) return true
    }
    return false
}

async function publicHost(hostname) {
    const host = String(hostname || '').toLowerCase()
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false
    if (net.isIP(host)) return !isPrivateIp(host)
    const records = await dns.lookup(host, { all: true })
    if (!records.length) return false
    return records.every((row) => !isPrivateIp(row.address))
}

function metaContent(html, keys) {
    const tags = html.match(/<meta\b[^>]*>/gi) || []
    for (const key of keys) {
        for (const tag of tags) {
            const prop = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase()
            if (prop !== key) continue
            const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]
            if (content) return content.trim()
        }
    }
    return ''
}

function metaImage(html) {
    return metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src'])
}

function cleanText(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
}

function metaTitle(html) {
    const fromMeta = cleanText(metaContent(html, ['og:title', 'twitter:title']))
    if (fromMeta) return fromMeta
    const titled = html.match(/<title[^>]*>([^<]{1,160})<\/title>/i)
    return cleanText(titled?.[1] || '')
}

async function readHtml(res) {
    const type = res.headers.get('content-type') || ''
    if (!/html|xml/i.test(type)) return ''
    const reader = res.body?.getReader?.()
    if (!reader) return ''
    const chunks = []
    let size = 0
    while (size < 180000) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        size += value.length
    }
    reader.cancel().catch(() => {})
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

/** Picture and name for a normal website. Empty when the site has none. Never throws. */
export async function fetchPagePreview(pageUrl) {
    const empty = { thumbnail: '', title: '' }
    const parsed = parseVideoLink(pageUrl)
    if (!parsed || parsed.provider !== 'link') return empty
    let current
    try {
        current = new URL(parsed.url)
    } catch {
        return empty
    }
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return empty
    for (let hop = 0; hop < 3; hop++) {
        if (!(await publicHost(current.hostname).catch(() => false))) return empty
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 4000)
        let res
        try {
            res = await fetch(current.href, {
                signal: ctrl.signal,
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    Accept: 'text/html',
                },
            })
        } catch {
            return empty
        } finally {
            clearTimeout(timer)
        }
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location')
            if (!loc) return empty
            try {
                current = new URL(loc, current)
            } catch {
                return empty
            }
            continue
        }
        if (!res.ok) return empty
        const html = await readHtml(res).catch(() => '')
        const title = metaTitle(html)
        const rawImg = metaImage(html)
        if (!rawImg) return { thumbnail: '', title }
        let img
        try {
            img = new URL(rawImg, current)
        } catch {
            return { thumbnail: '', title }
        }
        if (img.protocol !== 'https:' && img.protocol !== 'http:') return { thumbnail: '', title }
        if (!(await publicHost(img.hostname).catch(() => false))) return { thumbnail: '', title }
        return { thumbnail: img.href.slice(0, 500), title }
    }
    return empty
}

/** Share picture for a normal website. Empty when the site has none. Never throws. */
export async function fetchPageThumb(pageUrl) {
    const card = await fetchPagePreview(pageUrl)
    return card.thumbnail || ''
}
