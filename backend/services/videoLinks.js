/** Turn a pasted video URL into an embed + thumbnail. No outbound fetch. */

const YOUTUBE_ID = /^[\w-]{6,}$/

function youtubeIdFromUrl(u, host) {
    if (host === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || ''
    if (!host.endsWith('youtube.com') && host !== 'youtube-nocookie.com') return ''
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || ''
    if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || ''
    if (u.pathname.startsWith('/live/')) return u.pathname.split('/')[2] || ''
    return u.searchParams.get('v') || ''
}

export function parseVideoLink(raw) {
    const url = String(raw || '').trim()
    if (!/^https?:\/\//i.test(url) || url.length > 500) return null
    let u
    try {
        u = new URL(url)
    } catch {
        return null
    }
    const host = u.hostname.replace(/^www\./, '').toLowerCase()

    const yt = youtubeIdFromUrl(u, host)
    if (yt && YOUTUBE_ID.test(yt)) {
        return {
            provider: 'youtube',
            url,
            embedUrl: `https://www.youtube.com/embed/${yt}`,
            thumbnail: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
            title: 'YouTube',
        }
    }

    if (host.endsWith('dailymotion.com') || host === 'dai.ly') {
        const parts = u.pathname.split('/').filter(Boolean)
        let vid = ''
        if (host === 'dai.ly') vid = parts[0] || ''
        else if (parts[0] === 'video') vid = parts[1] || ''
        else if (parts[0] === 'embed' && parts[1] === 'video') vid = parts[2] || ''
        if (vid && /^[a-zA-Z0-9]+$/.test(vid)) {
            return {
                provider: 'dailymotion',
                url,
                embedUrl: `https://www.dailymotion.com/embed/video/${vid}`,
                thumbnail: `https://www.dailymotion.com/thumbnail/video/${vid}`,
                title: 'Dailymotion',
            }
        }
    }

    if (host.endsWith('vimeo.com')) {
        const vid = (u.pathname.split('/').filter(Boolean).pop() || '')
        if (/^\d+$/.test(vid)) {
            return {
                provider: 'vimeo',
                url,
                embedUrl: `https://player.vimeo.com/video/${vid}`,
                thumbnail: `https://vumbnail.com/${vid}.jpg`,
                title: 'Vimeo',
            }
        }
    }

    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u.pathname)) {
        return {
            provider: 'file',
            url,
            embedUrl: url,
            thumbnail: '',
            title: 'Video',
        }
    }

    if (!host.includes('.')) return null
    return {
        provider: 'link',
        url,
        embedUrl: url,
        thumbnail: '',
        title: host,
    }
}

export function channelThumbnail(channel) {
    const first = channel?.streams?.[0]
    if (first?.youtubeId) return `https://i.ytimg.com/vi/${first.youtubeId}/hqdefault.jpg`
    return channel?.logo || ''
}

export function decorateChannel(channel) {
    const thumbnail = channelThumbnail(channel)
    return {
        ...channel,
        thumbnail,
        streams: (channel.streams || []).map((stream) => ({
            ...stream,
            thumbnail: stream.youtubeId
                ? `https://i.ytimg.com/vi/${stream.youtubeId}/hqdefault.jpg`
                : thumbnail,
        })),
    }
}
