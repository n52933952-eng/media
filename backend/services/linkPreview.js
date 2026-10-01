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

function metaImage(html) {
    const tags = html.match(/<meta\b[^>]*>/gi) || []
    const keys = ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']
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

/** Share picture for a normal website. Empty when the site has none. Never throws. */
export async function fetchPageThumb(pageUrl) {
    const parsed = parseVideoLink(pageUrl)
    if (!parsed || parsed.provider !== 'link') return ''
    let current
    try {
        current = new URL(parsed.url)
    } catch {
        return ''
    }
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return ''
    for (let hop = 0; hop < 3; hop++) {
        if (!(await publicHost(current.hostname).catch(() => false))) return ''
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 4000)
        let res
        try {
            res = await fetch(current.href, {
                signal: ctrl.signal,
                redirect: 'manual',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; PlaySocial/1.0)',
                    Accept: 'text/html',
                },
            })
        } catch {
            return ''
        } finally {
            clearTimeout(timer)
        }
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location')
            if (!loc) return ''
            try {
                current = new URL(loc, current)
            } catch {
                return ''
            }
            continue
        }
        if (!res.ok) return ''
        const html = await readHtml(res).catch(() => '')
        const rawImg = metaImage(html)
        if (!rawImg) return ''
        let img
        try {
            img = new URL(rawImg, current)
        } catch {
            return ''
        }
        if (img.protocol !== 'https:' && img.protocol !== 'http:') return ''
        if (!(await publicHost(img.hostname).catch(() => false))) return ''
        return img.href.slice(0, 500)
    }
    return ''
}
