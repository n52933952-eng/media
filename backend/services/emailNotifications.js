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

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildFollowEmailHtml({ followerName, followerUsername, profileUrl, profilePic }) {
  const safeName = escapeHtml(followerName || followerUsername || 'Someone')
  const safeUser = followerUsername ? escapeHtml(`@${followerUsername}`) : ''
  const safeUrl = escapeHtml(profileUrl)
  const safeSite = escapeHtml(FRONTEND_URL)
  const initial = (followerName || followerUsername || 'P').charAt(0).toUpperCase()

  const avatarBlock = profilePic
    ? `<img src="${escapeHtml(profilePic)}" alt="" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid #e8eef7;" />`
    : `<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;font-size:28px;font-weight:700;line-height:72px;text-align:center;border:3px solid #e8eef7;">${escapeHtml(initial)}</div>`

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New follower on PlaySocial</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eef2f7;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
              <p style="margin:0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">PlaySocial</p>
              <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.9);">Connect · Play · Share</p>
            </td>
          </tr>
          <tr>
            <td style="background-color:#ffffff;padding:36px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.6px;">New follower</p>
              <h1 style="margin:0 0 24px;font-size:22px;line-height:1.35;color:#0f172a;font-weight:700;">Someone started following you</h1>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td width="72" valign="top" style="padding-right:16px;">${avatarBlock}</td>
                  <td valign="middle">
                    <p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">${safeName}</p>
                    ${safeUser ? `<p style="margin:6px 0 0;font-size:15px;color:#64748b;">${safeUser}</p>` : ''}
                    <p style="margin:12px 0 0;font-size:15px;line-height:1.5;color:#475569;">is now following you on PlaySocial.</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:linear-gradient(135deg,#2563eb,#4f46e5);">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">View profile</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#94a3b8;">
                You received this because you use PlaySocial on the web.
              </p>
              <a href="${safeSite}" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:600;">playsocial.social</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
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
      User.findById(followerId).select('name username profilePic').lean(),
    ])

    if (!followee?.email) {
      return { ok: false, skipped: true, reason: 'no_followee_email' }
    }

    const followerUsername = follower?.username || ''
    const followerName = follower?.name || followerUsername || 'Someone'
    const profilePath = followerUsername ? `/${followerUsername}` : '/'
    const profileUrl = `${FRONTEND_URL}${profilePath}`
    const subject = `${followerName} started following you on PlaySocial`
    const html = buildFollowEmailHtml({
      followerName,
      followerUsername,
      profileUrl,
      profilePic: follower?.profilePic || '',
    })

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
