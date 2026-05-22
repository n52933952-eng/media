import { Resend } from 'resend'
import User from '../models/user.js'

const EMAIL_FROM = process.env.EMAIL_FROM || 'notifications@playsocial.social'
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://playsocial.social').replace(/\/$/, '')
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim()

let resendClient = null

function getResendClient() {
  if (!RESEND_API_KEY) return null
  if (!resendClient) resendClient = new Resend(RESEND_API_KEY)
  return resendClient
}

export function getEmailProvider() {
  return RESEND_API_KEY ? 'resend' : 'none'
}

export function logEmailTransportStatus() {
  if (RESEND_API_KEY) {
    console.log(`📧 Email: Resend (from ${EMAIL_FROM})`)
    return
  }
  console.warn('📧 Email: not configured — set RESEND_API_KEY on Render')
}

export function getFollowClientType(req) {
  const header = String(req?.headers?.['x-client-type'] || '').toLowerCase()
  const body = String(req?.body?.clientType || '').toLowerCase()
  if (header === 'web' || body === 'web') return 'web'
  if (header === 'mobile' || body === 'mobile') return 'mobile'
  return 'unknown'
}

function buildFollowEmailHtml({ followerName, followerUsername, profileUrl }) {
  const safeName = followerName || followerUsername || 'Someone'
  const safeUser = followerUsername ? `@${followerUsername}` : ''
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 12px;">New follower on PlaySocial</h2>
      <p style="font-size:16px;line-height:1.5;color:#333;">
        <strong>${safeName}</strong>${safeUser ? ` (${safeUser})` : ''} started following you.
      </p>
      <p style="margin:24px 0;">
        <a href="${profileUrl}" style="display:inline-block;background:#3182ce;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">
          View profile
        </a>
      </p>
      <p style="font-size:12px;color:#888;">You received this because you use PlaySocial on the web.</p>
    </div>
  `.trim()
}

async function sendViaResend({ to, subject, html }) {
  const resend = getResendClient()
  if (!resend) return { ok: false, skipped: true, reason: 'resend_not_configured' }

  const from = EMAIL_FROM.includes('<')
    ? EMAIL_FROM
    : `PlaySocial <${EMAIL_FROM}>`

  const { data, error } = await resend.emails.send({ from, to: [to], subject, html })
  if (error) {
    const msg = error.message || String(error)
    console.error('📧 Resend error:', msg)
    return { ok: false, error: msg }
  }
  return { ok: true, messageId: data?.id, provider: 'resend' }
}

/**
 * Send follow email to the followee (web follows only — caller checks client).
 */
export async function sendWebFollowEmailToUser(followeeId, followerId) {
  try {
    const [followee, follower] = await Promise.all([
      User.findById(followeeId).select('email name username').lean(),
      User.findById(followerId).select('name username').lean(),
    ])

    if (!followee?.email) {
      return { ok: false, skipped: true, reason: 'no_followee_email' }
    }

    const followerUsername = follower?.username || ''
    const followerName = follower?.name || followerUsername || 'Someone'
    const profilePath = followerUsername ? `/${followerUsername}` : '/'
    const profileUrl = `${FRONTEND_URL}${profilePath}`
    const subject = `${followerName} started following you on PlaySocial`
    const html = buildFollowEmailHtml({ followerName, followerUsername, profileUrl })

    return await sendViaResend({
      to: followee.email,
      subject,
      html,
    })
  } catch (err) {
    console.error('📧 sendWebFollowEmailToUser error:', err)
    return { ok: false, error: err?.message || String(err) }
  }
}
