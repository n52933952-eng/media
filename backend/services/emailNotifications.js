/**
 * Optional follow emails via Nodemailer + SMTP (e.g. Gmail App Password).
 * If SMTP is not configured, sends no-op — follow / push / in-app unchanged.
 *
 * Env (Gmail example):
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=your@gmail.com
 *   SMTP_PASS=xxxx xxxx xxxx xxxx   (Google App Password, not your normal password)
 *   EMAIL_FROM=PlaySocial <your@gmail.com>
 *   FRONTEND_URL=https://your-site.com
 *
 * Aliases: GMAIL_USER / GMAIL_APP_PASSWORD work instead of SMTP_USER / SMTP_PASS.
 */

import nodemailer from 'nodemailer'
import User from '../models/user.js'

let cachedTransporter = null

/** @returns {'web' | 'mobile'} */
export function getFollowClientType(req) {
    const h = String(req.headers['x-client-type'] || req.headers['X-Client-Type'] || '')
        .trim()
        .toLowerCase()
    if (h === 'web' || h === 'mobile') return h
    const body = String(req.body?.clientType || '').trim().toLowerCase()
    if (body === 'web' || body === 'mobile') return body
    return 'mobile'
}

function getSmtpConfig() {
    const user = (
        process.env.SMTP_USER ||
        process.env.GMAIL_USER ||
        ''
    ).trim()
    const pass = (
        process.env.SMTP_PASS ||
        process.env.GMAIL_APP_PASSWORD ||
        ''
    ).trim().replace(/\s+/g, '') // app passwords often shown with spaces

    if (!user || !pass) return null

    const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim()
    const port = Number(process.env.SMTP_PORT || 587)
    const secure =
        process.env.SMTP_SECURE === 'true' || port === 465

    const from =
        (process.env.EMAIL_FROM || '').trim() ||
        `PlaySocial <${user}>`

    return { user, pass, host, port, secure, from }
}

function getTransporter() {
    const cfg = getSmtpConfig()
    if (!cfg) return null

    if (!cachedTransporter) {
        cachedTransporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: {
                user: cfg.user,
                pass: cfg.pass,
            },
        })
    }
    return { transporter: cachedTransporter, from: cfg.from }
}

function getAppOrigin() {
    const raw =
        process.env.FRONTEND_URL ||
        process.env.APP_URL ||
        process.env.FRONTEND_URL_PROD ||
        'http://localhost:5173'
    return String(raw).replace(/\/$/, '')
}

/** Initial letter for avatar circle when no profile photo. */
function avatarInitial(name, username) {
    const s = String(name || username || '?').trim()
    return s ? s.charAt(0).toUpperCase() : '?'
}

/**
 * HTML + plain-text bodies for “new follower” (email-client safe tables).
 * @param {{ displayName: string, username: string, profileUrl: string, profilePic?: string }} content
 */
function buildFollowEmailContent(content) {
    const { displayName, username, profileUrl, profilePic } = content
    const safeName = escapeHtml(displayName)
    const safeUser = username ? `@${escapeHtml(username)}` : ''
    const safeUrl = escapeHtml(profileUrl)
    const initial = escapeHtml(avatarInitial(displayName, username))
    const pic = profilePic && String(profilePic).startsWith('http') ? escapeHtml(profilePic) : ''

    const avatarBlock = pic
        ? `<img src="${pic}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #3d3d3d;" />`
        : `<div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#4a90d9 0%,#2b6cb0 100%);color:#fff;font-size:28px;font-weight:700;line-height:64px;text-align:center;border:3px solid #3d3d3d;">${initial}</div>`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>New follower on PlaySocial</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0f0f0f;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">PlaySocial</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color:#1a1a1a;border-radius:16px;border:1px solid #2a2a2a;overflow:hidden;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding:28px 28px 8px 28px;text-align:center;">
                    ${avatarBlock}
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 28px 8px 28px;text-align:center;">
                    <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">${safeName}</p>
                    ${safeUser ? `<p style="margin:8px 0 0 0;font-size:15px;color:#9ca3af;">${safeUser}</p>` : ''}
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 28px 20px 28px;text-align:center;">
                    <p style="margin:0;font-size:16px;color:#d1d5db;line-height:1.5;">started following you</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 28px 28px;text-align:center;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 32px;background-color:#3182ce;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;border-radius:10px;">View profile</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 12px 0 12px;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280;line-height:1.5;">
                See who they are and follow back on PlaySocial.
              </p>
              <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.5;">
                You received this email because someone followed you while you were away from the app.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()

    const text = [
        'PlaySocial',
        '',
        `${displayName}${username ? ` (@${username})` : ''} started following you.`,
        '',
        'View their profile:',
        profileUrl,
        '',
        '— PlaySocial',
    ].join('\n')

    const subject = username
        ? `${displayName} (@${username}) started following you`
        : `${displayName} started following you on PlaySocial`

    return { html, text, subject }
}

/**
 * @param {{ toEmail: string, followerUsername?: string, followerName?: string, followerId?: string, followerProfilePic?: string }} params
 */
export async function sendFollowEmailIfConfigured(params) {
    const mail = getTransporter()
    const toEmail = String(params?.toEmail || '').trim()

    if (!mail) {
        return { success: false, skipped: true, reason: 'SMTP not configured (SMTP_USER + SMTP_PASS)' }
    }
    if (!toEmail || !toEmail.includes('@')) {
        return { success: false, skipped: true, reason: 'invalid_email' }
    }

    const displayName = (params.followerName || params.followerUsername || 'Someone').trim()
    const username = (params.followerUsername || '').trim()
    const followerId = params.followerId ? String(params.followerId) : ''
    const appOrigin = getAppOrigin()
    const profilePath = username
        ? `/${encodeURIComponent(username)}`
        : followerId
          ? `/${encodeURIComponent(followerId)}`
          : '/home'
    const profileUrl = `${appOrigin}${profilePath}`

    const { html, text, subject } = buildFollowEmailContent({
        displayName,
        username,
        profileUrl,
        profilePic: params.followerProfilePic,
    })

    try {
        await mail.transporter.sendMail({
            from: mail.from,
            to: toEmail,
            subject,
            text,
            html,
        })
        console.log(`✅ [email] Follow email sent (SMTP) to ${toEmail} (follower: ${username || followerId})`)
        return { success: true }
    } catch (e) {
        console.error('❌ [email] Nodemailer follow email failed:', e?.message || e)
        return { success: false, error: e?.message || 'send_failed' }
    }
}

/** Web follow only: email followee when they were not reached in-app. */
export async function sendWebFollowEmailToUser(followeeId, followerId) {
    const [followee, follower] = await Promise.all([
        User.findById(followeeId).select('email username name').lean(),
        User.findById(followerId).select('username name profilePic').lean(),
    ])
    if (!followee?.email || !follower) {
        return { success: false, skipped: true, reason: 'missing_user_or_email' }
    }
    return sendFollowEmailIfConfigured({
        toEmail: followee.email,
        followerUsername: follower.username,
        followerName: follower.name,
        followerId: String(followerId),
        followerProfilePic: follower.profilePic,
    })
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
