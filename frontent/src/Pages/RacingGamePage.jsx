import React, { useEffect, useRef, useState, useContext, useCallback } from 'react'
import { Box, Flex, Text, Avatar, Badge, IconButton, Tooltip } from '@chakra-ui/react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import API_BASE_URL from '../config/api'
import { FaPhone, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash, FaFlag, FaTrophy } from 'react-icons/fa'
import { IoArrowBack } from 'react-icons/io5'

// ── Track geometry — stadium oval (two straights + two semicircular turns) ──────
const T = {
    outer: { sX: 380, sY: 280 },   // outer boundary: sX = half-straight length, sY = turn radius
    inner: { sX: 195, sY: 125 },   // inner grass island
}
// Finish line: vertical strip at x = 0 on the top straight
const FINISH_X  = 0
const FINISH_Y1 = -(T.outer.sY - 18)   // –262  (outer edge)
const FINISH_Y2 = -(T.inner.sY + 18)   // –143  (inner edge)
// Start position: top straight, centre of track, facing right (+X = driving direction)
const START = { x: 0, y: -(T.inner.sY + T.outer.sY) / 2, angle: 0 }  // y ≈ –202

// ── Containment helpers ───────────────────────────────────────────────────────
const insideOval = (wx, wy, sX, sY) => {
    const ax = Math.abs(wx), ay = Math.abs(wy)
    if (ax <= sX) return ay <= sY
    const dx = ax - sX
    return dx * dx + wy * wy <= sY * sY
}
const onTrack = (wx, wy) =>
    insideOval(wx, wy, T.outer.sX, T.outer.sY) &&
    !insideOval(wx, wy, T.inner.sX, T.inner.sY)

// ── Stadium-oval canvas path helper ──────────────────────────────────────────
const ovalPath = (ctx, cx, cy, sX, sY) => {
    ctx.beginPath()
    ctx.arc(cx + sX, cy, sY, -Math.PI / 2, Math.PI / 2, false)
    ctx.lineTo(cx - sX, cy + sY)
    ctx.arc(cx - sX, cy, sY, Math.PI / 2, Math.PI * 1.5, false)
    ctx.closePath()
}

// ── Physics constants (drift-racing style from the article) ──────────────────
const PHYS = {
    engine:   2100,
    brake:   -1500,
    steer:    40 * Math.PI / 180,
    wheelBase: 36,
    grip: { normal: 5.8, drift: 0.42, lat: 7 },
    drag:     0.44,
    maxSpeed: 860,
    drift: { minSpeed: 280, factor: 0.28 },
}
const TOTAL_LAPS  = 3
const POS_SYNC_MS = 80

// ── Car physics step (adapted from drift-racing article, no p2 needed) ────────
const stepCar = (s, keys, dt) => {
    const co = Math.cos(s.angle), si = Math.sin(s.angle)
    const fwd = [co, si], rgt = [-si, co]
    const vel = [s.vx, s.vy]
    const fwdSpd = vel[0] * fwd[0] + vel[1] * fwd[1]
    const latSpd = vel[0] * rgt[0] + vel[1] * rgt[1]

    let eng = 0
    if (keys.up)        eng = PHYS.engine
    else if (keys.down) eng = PHYS.brake

    const steerIn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
    if (steerIn !== 0 && Math.abs(fwdSpd) > 10) {
        const sa = steerIn * PHYS.steer
        const tr = PHYS.wheelBase / Math.tan(Math.abs(sa) || 0.0001)
        s.angVel = (fwdSpd / tr) * steerIn
    } else {
        s.angVel *= 0.80
    }

    const spd = Math.sqrt(s.vx ** 2 + s.vy ** 2)
    const drifting = eng > 0 && steerIn !== 0 &&
        spd > PHYS.drift.minSpeed && spd / PHYS.maxSpeed > PHYS.drift.factor

    let ax = fwd[0] * eng, ay = fwd[1] * eng
    const grip = drifting
        ? PHYS.grip.drift * (1 + spd / PHYS.maxSpeed)
        : PHYS.grip.normal
    ax += rgt[0] * (-latSpd * PHYS.grip.lat * grip)
    ay += rgt[1] * (-latSpd * PHYS.grip.lat * grip)

    if (!eng) {
        ax -= fwd[0] * fwdSpd * PHYS.drag
        ay -= fwd[1] * fwdSpd * PHYS.drag
    }

    s.vx += ax * dt
    s.vy += ay * dt
    const newSpd = Math.sqrt(s.vx ** 2 + s.vy ** 2)
    if (newSpd > PHYS.maxSpeed) {
        s.vx = s.vx / newSpd * PHYS.maxSpeed
        s.vy = s.vy / newSpd * PHYS.maxSpeed
    }

    // Advance position — bounce off walls
    const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt
    if (onTrack(nx, ny)) {
        s.x = nx; s.y = ny
    } else if (onTrack(nx, s.y)) {
        s.x = nx; s.vx *= 0.45; s.vy *= -0.35
    } else if (onTrack(s.x, ny)) {
        s.y = ny; s.vy *= 0.45; s.vx *= -0.35
    } else {
        s.vx *= -0.35; s.vy *= -0.35
    }
    s.angle += s.angVel * dt
    return { drifting, speed: newSpd }
}

// ── Draw the full track ────────────────────────────────────────────────────────
const drawTrack = (ctx, camX, camY, W, H) => {
    const ox = W / 2 - camX   // track-centre screen x
    const oy = H / 2 - camY   // track-centre screen y

    // ── Outer grass background ──
    ctx.fillStyle = '#2d7a2d'
    ctx.fillRect(0, 0, W, H)

    // Subtle grass grid
    ctx.save()
    ctx.strokeStyle = 'rgba(0,100,0,0.22)'
    ctx.lineWidth = 1
    const gs = 85
    for (let gx = ((ox % gs) + gs) % gs; gx < W; gx += gs) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke()
    }
    for (let gy = ((oy % gs) + gs) % gs; gy < H; gy += gs) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke()
    }
    ctx.restore()

    // Decorative trees (circles) outside outer boundary
    const treePts = [
        [T.outer.sX + T.outer.sY + 60,  0],
        [T.outer.sX + T.outer.sY + 60,  200],
        [T.outer.sX + T.outer.sY + 60, -200],
        [-(T.outer.sX + T.outer.sY + 60),  0],
        [-(T.outer.sX + T.outer.sY + 60),  200],
        [-(T.outer.sX + T.outer.sY + 60), -200],
        [0,   T.outer.sY + 70],
        [200, T.outer.sY + 70],
        [-200, T.outer.sY + 70],
        [0,  -(T.outer.sY + 70)],
        [200, -(T.outer.sY + 70)],
        [-200,-(T.outer.sY + 70)],
    ]
    treePts.forEach(([tx, ty]) => {
        const sx = ox + tx, sy = oy + ty
        ctx.fillStyle = 'rgba(0,0,0,0.2)'
        ctx.beginPath(); ctx.ellipse(sx + 7, sy + 7, 22, 14, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#1a4e1a'
        ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#2a7a2a'
        ctx.beginPath(); ctx.arc(sx - 7, sy - 7, 13, 0, Math.PI * 2); ctx.fill()
    })

    // Asphalt ring (evenodd: outer oval minus inner oval)
    ctx.beginPath()
    ctx.arc(ox + T.outer.sX, oy, T.outer.sY, -Math.PI / 2, Math.PI / 2)
    ctx.lineTo(ox - T.outer.sX, oy + T.outer.sY)
    ctx.arc(ox - T.outer.sX, oy, T.outer.sY, Math.PI / 2, Math.PI * 1.5)
    ctx.closePath()
    ctx.arc(ox + T.inner.sX, oy, T.inner.sY, -Math.PI / 2, Math.PI / 2)
    ctx.lineTo(ox - T.inner.sX, oy + T.inner.sY)
    ctx.arc(ox - T.inner.sX, oy, T.inner.sY, Math.PI / 2, Math.PI * 1.5)
    ctx.closePath()
    ctx.fillStyle = '#1c1c20'
    ctx.fill('evenodd')

    // Subtle asphalt texture (light lines)
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.lineWidth = 1
    for (let gx = ((ox % gs) + gs) % gs; gx < W; gx += gs) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke()
    }
    ctx.restore()

    // Inner grass (on top of asphalt ring to cover centre)
    ovalPath(ctx, ox, oy, T.inner.sX, T.inner.sY)
    ctx.fillStyle = '#2a7a2a'
    ctx.fill()

    // Inner grass grid
    ctx.save()
    ovalPath(ctx, ox, oy, T.inner.sX, T.inner.sY)
    ctx.clip()
    ctx.strokeStyle = 'rgba(0,100,0,0.3)'
    ctx.lineWidth = 1
    for (let gx = ((ox % gs) + gs) % gs; gx < W; gx += gs) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke()
    }
    for (let gy = ((oy % gs) + gs) % gs; gy < H; gy += gs) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke()
    }
    ctx.restore()

    // Inner circle decoration (logo / grass marker)
    ctx.fillStyle = '#1f6b1f'
    ctx.beginPath()
    ctx.arc(ox, oy, 35, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#3aaa3a'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(ox, oy, 35, 0, Math.PI * 2); ctx.stroke()

    // ── Outer curb (red / white alternating dashes) ──
    ctx.save()
    ctx.lineWidth = 16
    ctx.strokeStyle = '#dd2020'
    ctx.setLineDash([34, 34])
    ovalPath(ctx, ox, oy, T.outer.sX, T.outer.sY)
    ctx.stroke()
    ctx.strokeStyle = '#f0f0f0'
    ctx.lineDashOffset = 34
    ovalPath(ctx, ox, oy, T.outer.sX, T.outer.sY)
    ctx.stroke()
    ctx.setLineDash([]); ctx.lineDashOffset = 0
    ctx.restore()

    // ── Inner curb ──
    ctx.save()
    ctx.lineWidth = 11
    ctx.strokeStyle = '#dd2020'
    ctx.setLineDash([26, 26])
    ovalPath(ctx, ox, oy, T.inner.sX, T.inner.sY)
    ctx.stroke()
    ctx.strokeStyle = '#f0f0f0'
    ctx.lineDashOffset = 26
    ovalPath(ctx, ox, oy, T.inner.sX, T.inner.sY)
    ctx.stroke()
    ctx.setLineDash([]); ctx.lineDashOffset = 0
    ctx.restore()

    // ── Centre dashed lane marking ──
    const midSX = (T.outer.sX + T.inner.sX) / 2
    const midSY = (T.outer.sY + T.inner.sY) / 2
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,150,0.45)'
    ctx.lineWidth = 3
    ctx.setLineDash([38, 38])
    ovalPath(ctx, ox, oy, midSX, midSY)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // ── Finish line (checkered vertical strip at x = 0 on top straight) ──
    const flSX = ox + FINISH_X
    const flSY1 = oy + FINISH_Y1   // –262 in world → oy – 262 on screen
    const flSY2 = oy + FINISH_Y2   // –143
    const sqSz = 13
    const numSq = Math.floor((flSY2 - flSY1) / sqSz)
    for (let i = 0; i < numSq; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#111111'
        ctx.fillRect(flSX - sqSz, flSY1 + i * sqSz, sqSz, sqSz)
        ctx.fillStyle = i % 2 === 0 ? '#111111' : '#ffffff'
        ctx.fillRect(flSX, flSY1 + i * sqSz, sqSz, sqSz)
    }

    // Start grid markers
    for (let i = 0; i < 3; i++) {
        const gx = ox + (-2 + i) * 36
        const gy = oy + START.y + 18
        ctx.fillStyle = 'rgba(255,255,0,0.5)'
        ctx.fillRect(gx - 10, gy, 20, 6)
    }
}

// ── Draw particles (drift smoke) ─────────────────────────────────────────────
const drawParticles = (ctx, particles, camX, camY, W, H) => {
    particles.forEach(p => {
        const sx = W / 2 + p.x - camX
        const sy = H / 2 + p.y - camY
        if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) return
        ctx.fillStyle = `rgba(220,220,220,${p.life * 0.35})`
        ctx.beginPath()
        ctx.arc(sx, sy, p.size, 0, Math.PI * 2)
        ctx.fill()
    })
}

// ── Draw a car — TOP-DOWN VIEW ────────────────────────────────────────────────
// cx/cy = SCREEN coords (already world-to-screen converted), angle in radians
const drawCar = (ctx, cx, cy, angle, bodyColor, accentColor, braking) => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)   // angle=0 → car faces RIGHT (+X)

    const L = 42, W = 23   // car length, width

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.beginPath(); ctx.ellipse(4, 6, L * 0.52, W * 0.42, 0, 0, Math.PI * 2); ctx.fill()

    // Main body
    ctx.fillStyle = bodyColor
    ctx.beginPath(); ctx.roundRect(-L / 2, -W / 2, L, W, 5); ctx.fill()

    // Side highlight strip
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(-L / 2 + 4, -W / 2, L - 8, 4)

    // Body outline
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.roundRect(-L / 2, -W / 2, L, W, 5); ctx.stroke()

    // Windshield (front = +X direction)
    ctx.fillStyle = 'rgba(160,235,255,0.82)'
    ctx.beginPath(); ctx.roundRect(L / 2 - 14, -W / 2 + 3, 12, W - 6, 3); ctx.fill()

    // Rear window
    ctx.fillStyle = 'rgba(130,205,235,0.65)'
    ctx.beginPath(); ctx.roundRect(-L / 2 + 2, -W / 2 + 3, 10, W - 6, 3); ctx.fill()

    // Hood divider line
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(L / 2 - 14, -W / 2); ctx.lineTo(L / 2 - 14, W / 2); ctx.stroke()

    // Headlights
    ctx.fillStyle = '#ffffaa'
    ctx.fillRect(L / 2 - 4, -W / 2 + 3, 4, 5)
    ctx.fillRect(L / 2 - 4, W / 2 - 8, 4, 5)

    // Tail lights
    ctx.fillStyle = braking ? '#ff2200' : '#880000'
    ctx.fillRect(-L / 2, -W / 2 + 3, 5, 5)
    ctx.fillRect(-L / 2, W / 2 - 8, 5, 5)
    if (braking) {
        ctx.fillStyle = 'rgba(255,80,0,0.4)'
        ctx.fillRect(-L / 2 - 3, -W / 2 + 1, 8, 8)
        ctx.fillRect(-L / 2 - 3, W / 2 - 9, 8, 8)
    }

    // Wheels (4 corners)
    ctx.fillStyle = '#111'
    const wp = [
        [L / 2 - 11, -W / 2 - 5],
        [L / 2 - 11,  W / 2 + 1],
        [-L / 2 + 6, -W / 2 - 5],
        [-L / 2 + 6,  W / 2 + 1],
    ]
    wp.forEach(([wx, wy]) => {
        ctx.beginPath(); ctx.roundRect(wx - 5, wy, 10, 5, 1); ctx.fill()
        ctx.fillStyle = '#666'
        ctx.beginPath(); ctx.roundRect(wx - 3, wy + 1, 6, 3, 1); ctx.fill()
        ctx.fillStyle = '#111'
    })

    // Rear spoiler
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(-L / 2 - 6, -W / 2 + 2, 5, W - 4)
    ctx.fillStyle = accentColor
    ctx.fillRect(-L / 2 - 6, -W / 2 + 2, 5, 4)
    ctx.fillRect(-L / 2 - 6, W / 2 - 6, 5, 4)

    // Racing number plate
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.beginPath(); ctx.roundRect(-4, -5, 14, 10, 2); ctx.fill()
    ctx.fillStyle = '#111'
    ctx.font = 'bold 8px Arial'
    ctx.textAlign = 'center'
    ctx.fillText('1', 3, 5)

    ctx.restore()
}

// ── Draw minimap ──────────────────────────────────────────────────────────────
const drawMinimap = (ctx, W, H, carX, carY, oppX, oppY) => {
    const MC = { x: W - 95, y: H - 95 }
    const SC = 0.08
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.62)'
    ctx.beginPath(); ctx.arc(MC.x, MC.y, 80, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(MC.x, MC.y, 80, 0, Math.PI * 2); ctx.stroke()

    // Asphalt ring on minimap
    const drawMMOval = (sX, sY) => {
        ctx.arc(MC.x + sX * SC, MC.y, sY * SC, -Math.PI / 2, Math.PI / 2)
        ctx.lineTo(MC.x - sX * SC, MC.y + sY * SC)
        ctx.arc(MC.x - sX * SC, MC.y, sY * SC, Math.PI / 2, Math.PI * 1.5)
        ctx.closePath()
    }
    ctx.beginPath(); drawMMOval(T.outer.sX, T.outer.sY)
    ctx.beginPath(); drawMMOval(T.outer.sX, T.outer.sY); drawMMOval(T.inner.sX, T.inner.sY)
    ctx.fillStyle = '#2e2e2e'; ctx.fill('evenodd')
    ctx.fillStyle = '#2a7a2a'
    ctx.beginPath(); drawMMOval(T.inner.sX, T.inner.sY); ctx.fill()

    // Finish line
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(MC.x - 1, MC.y + FINISH_Y1 * SC, 2, (FINISH_Y2 - FINISH_Y1) * SC)

    // Player dot
    ctx.fillStyle = '#e74c3c'
    ctx.beginPath(); ctx.arc(MC.x + carX * SC, MC.y + carY * SC, 5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(MC.x + carX * SC, MC.y + carY * SC, 5, 0, Math.PI * 2); ctx.stroke()

    // Opponent dot
    ctx.fillStyle = '#3366ff'
    ctx.beginPath(); ctx.arc(MC.x + oppX * SC, MC.y + oppY * SC, 5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(MC.x + oppX * SC, MC.y + oppY * SC, 5, 0, Math.PI * 2); ctx.stroke()

    ctx.restore()
}

// ── Main component ─────────────────────────────────────────────────────────────
const RacingGamePage = () => {
    const { opponentId } = useParams()
    const navigate       = useNavigate()
    const location       = useLocation()
    const { user }       = useContext(UserContext)
    const { socket, endRaceGameOnNavigate, callUser, leaveCall, callAccepted, stream } = useContext(SocketContext) || {}

    const canvasRef       = useRef(null)
    const keysRef         = useRef({ up: false, down: false, left: false, right: false })
    const carRef          = useRef({ ...START, vx: 0, vy: 0, angVel: 0 })
    const oppRef          = useRef({ x: -40, y: START.y, angle: 0, speed: 0, lap: 0 })
    const particlesRef    = useRef([])
    const camRef          = useRef({ x: START.x, y: START.y })
    const lapRef          = useRef({ laps: 0, prevX: START.x, beenLeft: false })
    const animRef         = useRef(null)
    const lastTimeRef     = useRef(null)
    const syncTimerRef    = useRef(null)
    const previousPathRef = useRef(location.pathname)

    const [roomId,     setRoomId]     = useState(() => localStorage.getItem('raceRoomId'))
    const [opponent,   setOpponent]   = useState(null)
    const [gameLive,   setGameLive]   = useState(false)
    const [gameOver,   setGameOver]   = useState(false)
    const [winnerId,   setWinnerId]   = useState(null)
    const [myLap,      setMyLap]      = useState(0)
    const [oppLap,     setOppLap]     = useState(0)
    const [mySpeed,    setMySpeed]    = useState(0)
    const [countdown,  setCountdown]  = useState(null)
    const [isMuted,    setIsMuted]    = useState(false)
    const [inCall,     setInCall]     = useState(false)
    const [callActive, setCallActive] = useState(false)

    // roomId might arrive after mount if we're the challenger
    useEffect(() => {
        if (!socket) return
        const h = ({ roomId: rId }) => {
            if (rId) { localStorage.setItem('raceRoomId', rId); setRoomId(rId) }
        }
        socket.on('acceptRaceChallenge', h)
        return () => socket.off('acceptRaceChallenge', h)
    }, [socket])

    // Fetch opponent profile
    useEffect(() => {
        if (!opponentId) return
        const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
        fetch(`${base}/api/user/getUserPro/${opponentId}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?._id) setOpponent(d) })
            .catch(() => {})
    }, [opponentId])

    useEffect(() => { if (callAccepted) setCallActive(true) }, [callAccepted])

    // Socket: opponent position, race result, opponent left
    useEffect(() => {
        if (!socket || !roomId) return
        const onPos = (data) => {
            if (data.wx !== undefined) {
                oppRef.current = { x: data.wx, y: data.wy, angle: data.wangle ?? 0, speed: data.speed ?? 0, lap: data.lap ?? 0 }
            }
            setOppLap(data.lap ?? 0)
        }
        const onRes  = ({ winnerId: w }) => { setWinnerId(w); setGameOver(true); cancelAnimationFrame(animRef.current); clearInterval(syncTimerRef.current) }
        const onLeft = () => { setGameOver(true); setWinnerId(user?._id); cancelAnimationFrame(animRef.current); clearInterval(syncTimerRef.current) }
        socket.on('raceOpponentPos',  onPos)
        socket.on('raceResult',       onRes)
        socket.on('raceOpponentLeft', onLeft)
        return () => { socket.off('raceOpponentPos', onPos); socket.off('raceResult', onRes); socket.off('raceOpponentLeft', onLeft) }
    }, [socket, roomId, user?._id])

    // Countdown — starts when roomId is available
    useEffect(() => {
        if (!roomId) return
        let c = 3
        setCountdown(c)
        const iv = setInterval(() => {
            c--; setCountdown(c)
            if (c <= 0) { clearInterval(iv); setCountdown(null); setGameLive(true) }
        }, 1000)
        return () => clearInterval(iv)
    }, [roomId])

    // Keyboard listeners
    useEffect(() => {
        const dn = (e) => {
            if (e.key === 'ArrowUp'    || e.key === 'w' || e.key === 'W') keysRef.current.up    = true
            if (e.key === 'ArrowDown'  || e.key === 's' || e.key === 'S') keysRef.current.down  = true
            if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keysRef.current.left  = true
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRef.current.right = true
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault()
        }
        const up = (e) => {
            if (e.key === 'ArrowUp'    || e.key === 'w' || e.key === 'W') keysRef.current.up    = false
            if (e.key === 'ArrowDown'  || e.key === 's' || e.key === 'S') keysRef.current.down  = false
            if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keysRef.current.left  = false
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRef.current.right = false
        }
        window.addEventListener('keydown', dn)
        window.addEventListener('keyup',   up)
        return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
    }, [])

    // ── Main game loop ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!gameLive || gameOver) return
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        const W = canvas.width, H = canvas.height

        const loop = (ts) => {
            if (!lastTimeRef.current) lastTimeRef.current = ts
            const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05)
            lastTimeRef.current = ts

            // Physics update
            const car   = carRef.current
            const keys  = keysRef.current
            const prevX = car.x
            const { drifting, speed } = stepCar(car, keys, dt)
            setMySpeed(Math.round(speed))

            // Lap counting — cross x=0 on top straight going right, after having gone left
            if (car.x < FINISH_X - 100) lapRef.current.beenLeft = true
            if (lapRef.current.beenLeft &&
                prevX < FINISH_X && car.x >= FINISH_X &&
                car.y >= FINISH_Y1 && car.y <= FINISH_Y2) {
                lapRef.current.laps++
                lapRef.current.beenLeft = false
                setMyLap(lapRef.current.laps)
                if (lapRef.current.laps >= TOTAL_LAPS && socket && roomId) {
                    socket.emit('raceFinished', { roomId, winnerId: user?._id, time: Date.now() })
                    setWinnerId(user?._id)
                    setGameOver(true)
                    cancelAnimationFrame(animRef.current)
                    clearInterval(syncTimerRef.current)
                    return
                }
            }

            // Drift smoke particles
            if (drifting) {
                const bx = car.x - Math.cos(car.angle) * 20
                const by = car.y - Math.sin(car.angle) * 20
                particlesRef.current.push({
                    x: bx + (Math.random() - 0.5) * 16,
                    y: by + (Math.random() - 0.5) * 16,
                    vx: (Math.random() - 0.5) * 55 - Math.cos(car.angle) * 25,
                    vy: (Math.random() - 0.5) * 55 - Math.sin(car.angle) * 25,
                    life: 1.0,
                    size: 7 + Math.random() * 9,
                })
                while (particlesRef.current.length > 120) particlesRef.current.shift()
            }
            particlesRef.current = particlesRef.current
                .map(p => ({ ...p, life: p.life - dt * 0.85, size: p.size * (1 + dt * 0.4), vx: p.vx * 0.94, vy: p.vy * 0.94, x: p.x + p.vx * dt, y: p.y + p.vy * dt }))
                .filter(p => p.life > 0)

            // Camera smooth follow with look-ahead
            const lookAheadDist = 70
            const targetCamX = car.x + Math.cos(car.angle) * lookAheadDist
            const targetCamY = car.y + Math.sin(car.angle) * lookAheadDist
            camRef.current.x += (targetCamX - camRef.current.x) * 0.08
            camRef.current.y += (targetCamY - camRef.current.y) * 0.08
            const camX = camRef.current.x, camY = camRef.current.y

            // ── Render ──────────────────────────────────────────────────────
            ctx.clearRect(0, 0, W, H)
            drawTrack(ctx, camX, camY, W, H)
            drawParticles(ctx, particlesRef.current, camX, camY, W, H)

            // Opponent car
            const opp = oppRef.current
            const oppSX = W / 2 + opp.x - camX
            const oppSY = H / 2 + opp.y - camY
            drawCar(ctx, oppSX, oppSY, opp.angle, '#2255cc', '#66aaff', opp.speed < 50)

            // Player car
            const carSX = W / 2 + car.x - camX
            const carSY = H / 2 + car.y - camY
            drawCar(ctx, carSX, carSY, car.angle, '#e74c3c', '#ffcc00', keys.down || speed < 50)

            // Minimap
            drawMinimap(ctx, W, H, car.x, car.y, opp.x, opp.y)

            animRef.current = requestAnimationFrame(loop)
        }

        animRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(animRef.current)
    }, [gameLive, gameOver, socket, roomId, user?._id])

    // Position sync
    useEffect(() => {
        if (!gameLive || gameOver || !socket || !roomId) return
        syncTimerRef.current = setInterval(() => {
            const c = carRef.current
            socket.emit('racePosUpdate', {
                roomId,
                wx: c.x, wy: c.y, wangle: c.angle,
                speed: Math.sqrt(c.vx ** 2 + c.vy ** 2),
                lap: lapRef.current.laps,
            })
        }, POS_SYNC_MS)
        return () => clearInterval(syncTimerRef.current)
    }, [gameLive, gameOver, socket, roomId])

    // Navigation guards
    useEffect(() => {
        const onPop = () => { if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) endRaceGameOnNavigate() }
        window.addEventListener('popstate', onPop)
        return () => window.removeEventListener('popstate', onPop)
    }, [endRaceGameOnNavigate])

    useEffect(() => {
        const cur = location.pathname, prev = previousPathRef.current
        if (prev.startsWith('/race/') && !cur.startsWith('/race/') && localStorage.getItem('raceRoomId') && endRaceGameOnNavigate)
            endRaceGameOnNavigate()
        previousPathRef.current = cur
    }, [location.pathname, endRaceGameOnNavigate])

    useEffect(() => {
        return () => {
            setTimeout(() => {
                if (!window.location.pathname.startsWith('/race/') && localStorage.getItem('raceRoomId') && endRaceGameOnNavigate)
                    endRaceGameOnNavigate()
            }, 50)
        }
    }, [endRaceGameOnNavigate])

    const handleLeave = useCallback(() => {
        if (inCall || callActive) leaveCall?.()
        if (endRaceGameOnNavigate) endRaceGameOnNavigate()
        navigate('/home')
    }, [endRaceGameOnNavigate, navigate, inCall, callActive, leaveCall])

    const handleCallBtn = () => {
        if (callActive || inCall) { leaveCall?.(); setCallActive(false); setInCall(false) }
        else { callUser?.(opponentId, 'audio'); setInCall(true) }
    }

    const toggleMute = () => {
        stream?.getAudioTracks().forEach(t => { t.enabled = isMuted })
        setIsMuted(m => !m)
    }

    return (
        <Box position="fixed" inset={0} bg="#1c1c20" display="flex" flexDirection="column" overflow="hidden" userSelect="none">
            {/* Top HUD */}
            <Flex
                position="absolute" top={0} left={0} right={0}
                px={4} py={2} zIndex={20}
                justify="space-between" align="center"
                bg="rgba(0,0,0,0.72)"
                backdropFilter="blur(10px)"
                borderBottom="1px solid rgba(255,200,0,0.2)"
            >
                {/* Left: back + player */}
                <Flex align="center" gap={3}>
                    <Tooltip label="Leave race">
                        <IconButton icon={<IoArrowBack />} size="sm" variant="ghost"
                            color="white" onClick={handleLeave} aria-label="Leave"
                            _hover={{ bg: 'rgba(255,100,0,0.25)' }} />
                    </Tooltip>
                    <Avatar size="sm" src={user?.profilePic} name={user?.name || user?.username}
                        border="2px solid #e74c3c" />
                    <Box>
                        <Text color="white" fontWeight="bold" fontSize="sm" lineHeight={1}>{user?.name || user?.username}</Text>
                        <Text color="#ff7700" fontSize="xs">Lap {Math.min(myLap + 1, TOTAL_LAPS)}/{TOTAL_LAPS}</Text>
                    </Box>
                </Flex>

                {/* Center: speed */}
                <Flex direction="column" align="center">
                    <Text color="#ffdd00" fontWeight="black" fontSize="2xl" lineHeight={1}>{mySpeed}</Text>
                    <Text color="gray.400" fontSize="9px" letterSpacing="wider">KM/H</Text>
                </Flex>

                {/* Right: opponent + voice */}
                <Flex align="center" gap={3}>
                    <Box textAlign="right">
                        <Text color="white" fontWeight="bold" fontSize="sm" lineHeight={1}>{opponent?.name || opponent?.username || 'Opponent'}</Text>
                        <Text color="#7eb8ff" fontSize="xs">Lap {Math.min(oppLap + 1, TOTAL_LAPS)}/{TOTAL_LAPS}</Text>
                    </Box>
                    <Avatar size="sm" src={opponent?.profilePic} name={opponent?.name || opponent?.username}
                        border="2px solid #2255dd" />
                    <Flex gap={1}>
                        {(callActive || inCall) && (
                            <Tooltip label={isMuted ? 'Unmute' : 'Mute'}>
                                <IconButton icon={isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                                    size="sm" colorScheme={isMuted ? 'red' : 'green'}
                                    onClick={toggleMute} aria-label="mute" />
                            </Tooltip>
                        )}
                        <Tooltip label={(callActive || inCall) ? 'End call' : 'Voice call'}>
                            <IconButton icon={(callActive || inCall) ? <FaPhoneSlash /> : <FaPhone />}
                                size="sm" colorScheme={(callActive || inCall) ? 'red' : 'green'}
                                onClick={handleCallBtn} aria-label="call" />
                        </Tooltip>
                    </Flex>
                </Flex>
            </Flex>

            {/* Canvas */}
            <canvas ref={canvasRef} width={960} height={580}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

            {/* Key hints */}
            <Flex position="absolute" bottom={3} left={0} right={0} justify="center" gap={3} zIndex={10}>
                {['↑ / W  Accelerate', '↓ / S  Brake', '← / A  Left', '→ / D  Right'].map(k => (
                    <Badge key={k} bg="rgba(255,200,0,0.15)" color="rgba(255,230,100,0.9)"
                        px={2} py={1} borderRadius="md" fontSize="10px" border="1px solid rgba(255,180,0,0.3)">
                        {k}
                    </Badge>
                ))}
            </Flex>

            {/* Countdown overlay */}
            {countdown !== null && countdown > 0 && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center"
                    bg="rgba(0,0,0,0.6)" pointerEvents="none" flexDirection="column" gap={3}>
                    <Text fontSize="11px" color="rgba(255,200,100,0.75)" letterSpacing="widest" textTransform="uppercase">
                        Get Ready!
                    </Text>
                    <Text fontSize="120px" fontWeight="black" lineHeight={1}
                        color={countdown === 1 ? '#ff3300' : countdown === 2 ? '#ffcc00' : '#ffffff'}
                        style={{ textShadow: `0 0 60px ${countdown === 1 ? '#ff3300' : countdown === 2 ? '#ffcc00' : '#aaaaff'}` }}>
                        {countdown}
                    </Text>
                </Flex>
            )}
            {countdown === 0 && !gameLive && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center" bg="rgba(0,0,0,0.45)" pointerEvents="none">
                    <Text fontSize="90px" fontWeight="black" lineHeight={1} color="#33ff66"
                        style={{ textShadow: '0 0 50px #00ff44' }}>GO!</Text>
                </Flex>
            )}

            {/* Waiting for room */}
            {!roomId && !gameOver && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center" bg="rgba(0,0,0,0.82)">
                    <Box textAlign="center">
                        <Text fontSize="52px" mb={2}>🏎️</Text>
                        <Text color="white" fontSize="xl" fontWeight="bold" mb={2}>Waiting for race to start…</Text>
                        <Text color="rgba(255,180,0,0.7)" fontSize="sm">Connecting to opponent</Text>
                    </Box>
                </Flex>
            )}

            {/* Game over */}
            {gameOver && (
                <Flex position="absolute" inset={0} zIndex={40} align="center" justify="center" bg="rgba(0,0,0,0.85)">
                    <Box bg="linear-gradient(135deg,#0a0a1e,#1a1a0e)"
                        borderRadius="2xl" p={10} textAlign="center"
                        border="2px solid rgba(255,200,0,0.35)"
                        boxShadow="0 0 80px rgba(255,180,0,0.25)" minW="340px">
                        {winnerId === user?._id ? (
                            <>
                                <FaTrophy size={60} color="#FFD700" style={{ margin: '0 auto 14px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="#FFD700" mb={2}>🏆 You Win!</Text>
                                <Text color="rgba(255,230,150,0.8)" mb={8}>You crossed the finish line first!</Text>
                            </>
                        ) : winnerId ? (
                            <>
                                <FaFlag size={52} color="#888" style={{ margin: '0 auto 14px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="gray.400" mb={2}>Race Over</Text>
                                <Text color="rgba(200,200,200,0.7)" mb={8}>Your opponent was faster.</Text>
                            </>
                        ) : (
                            <>
                                <FaFlag size={52} color="#e74c3c" style={{ margin: '0 auto 14px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="#e74c3c" mb={2}>Opponent Left</Text>
                                <Text color="rgba(200,200,200,0.7)" mb={8}>You win by default!</Text>
                            </>
                        )}
                        <Box as="button" px={10} py={3} borderRadius="xl"
                            bg="linear-gradient(90deg,#cc7700,#ffcc00)"
                            color="#111" fontWeight="bold" fontSize="md"
                            _hover={{ transform: 'scale(1.05)' }} transition="all 0.2s"
                            onClick={handleLeave}>
                            Back to Home
                        </Box>
                    </Box>
                </Flex>
            )}
        </Box>
    )
}

export default RacingGamePage
