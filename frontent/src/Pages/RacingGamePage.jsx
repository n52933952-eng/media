import React, { useEffect, useRef, useState, useContext, useCallback } from 'react'
import { Box, Flex, Text, Avatar, Badge, IconButton, Tooltip } from '@chakra-ui/react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import API_BASE_URL from '../config/api'
import { FaPhone, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash, FaFlag, FaTrophy } from 'react-icons/fa'
import { IoArrowBack } from 'react-icons/io5'

// ── Road / physics constants ─────────────────────────────────────────────────
const ROAD_WIDTH  = 2000
const SEG_LEN     = 200
const TOTAL_SEGS  = 600
const CAM_HEIGHT  = 1500
const CAM_DEPTH   = 0.84
const VISIBLE     = 180
const MAX_SPEED   = 500
const ACCEL       = 240
const BRAKE       = 560
const FRICTION    = 0.97
const STEERING    = 3.8
const TOTAL_LAPS  = 3
const CENTRIFUGAL = 0.3
const POS_SYNC_MS = 80

// ── Build track ───────────────────────────────────────────────────────────────
const buildTrack = () => {
    const segs = []
    for (let i = 0; i < TOTAL_SEGS; i++) {
        let curve = 0, y = 0
        if (i > 40  && i < 120) curve =  2.0
        if (i > 150 && i < 220) curve = -2.3
        if (i > 260 && i < 330) curve =  1.6
        if (i > 380 && i < 450) curve = -1.8
        if (i > 480 && i < 560) curve =  2.2
        if (i > 100 && i < 180) y = Math.sin((i - 100) * 0.06) * 700
        if (i > 350 && i < 430) y = Math.sin((i - 350) * 0.07) * 500
        const sprites = []
        if (i % 6 === 0) {
            sprites.push({ offset:  2.6, type: 'tree',     scale: 0.8  + (i % 5) * 0.12 })
            sprites.push({ offset: -2.6, type: 'tree',     scale: 0.8  + (i % 7) * 0.1  })
        }
        if (i % 10 === 5) {
            sprites.push({ offset:  3.4, type: 'tree',     scale: 0.6  + (i % 4) * 0.1  })
            sprites.push({ offset: -3.4, type: 'tree',     scale: 0.6  + (i % 4) * 0.1  })
        }
        if (i % 35 === 15) {
            sprites.push({ offset:  5.2, type: 'building', scale: 1.0  + (i % 5) * 0.2  })
            sprites.push({ offset: -5.2, type: 'building', scale: 1.0  + (i % 5) * 0.2  })
        }
        segs.push({ index: i, curve, y, sprites })
    }
    return segs
}
const TRACK = buildTrack()

// ── Project 3‑D world point → 2‑D screen ──────────────────────────────────────
const project = (worldX, worldY, worldZ, camX, camY, camZ, camDepth, W, H, roadW) => {
    const scale = camDepth / (worldZ - camZ)
    const sx    = Math.round((W / 2) + scale * (worldX - camX) * (W / 2))
    const sy    = Math.round((H / 2) - scale * (worldY - camY) * (H / 2))
    const sw    = Math.round(scale * roadW * (W / 2))
    return { sx, sy, sw, scale }
}

// ── Draw road trapezoid ────────────────────────────────────────────────────────
const drawSegment = (ctx, W, p1, p2, alt, fog) => {
    const { sx: x1, sy: y1, sw: w1 } = p1
    const { sx: x2, sy: y2, sw: w2 } = p2
    const grass  = alt ? '#1a5c1a' : '#239023'
    const road   = alt ? '#1c1c1e' : '#252528'
    const rumble = alt ? '#cc1111' : '#dddddd'

    const poly = (col, ax, ay, bx, by, cx, cy, dx, dy) => {
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy)
        ctx.closePath(); ctx.fill()
    }

    poly(grass,  0, y2, W, y2, W, y1, 0, y1)
    poly(road,   x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2)

    const rw1 = w1 * 0.13, rw2 = w2 * 0.13
    poly(rumble, x1 - w1, y1, x1 - w1 + rw1, y1, x2 - w2 + rw2, y2, x2 - w2, y2)
    poly(rumble, x1 + w1 - rw1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 - rw2, y2)

    // White edge lines
    const ew1 = w1 * 0.025, ew2 = w2 * 0.025
    poly('#ffffff', x1 - w1 + rw1, y1, x1 - w1 + rw1 + ew1, y1, x2 - w2 + rw2 + ew2, y2, x2 - w2 + rw2, y2)
    poly('#ffffff', x1 + w1 - rw1 - ew1, y1, x1 + w1 - rw1, y1, x2 + w2 - rw2, y2, x2 + w2 - rw2 - ew2, y2)

    // Center lane dash
    if (!alt) {
        const lw1 = w1 * 0.035, lw2 = w2 * 0.035
        poly('#ffff99', x1 - lw1, y1, x1 + lw1, y1, x2 + lw2, y2, x2 - lw2, y2)
    }
    if (fog > 0) {
        ctx.fillStyle = `rgba(13,13,43,${fog * 0.65})`
        ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(W, y2); ctx.lineTo(W, y1); ctx.lineTo(0, y1); ctx.closePath(); ctx.fill()
    }
}

// ── Draw pine tree (layered, silhouette‑style) ─────────────────────────────────
const drawTree = (ctx, sx, sy, scale) => {
    if (scale < 0.018 || sy < 10) return
    const h = 190 * scale, tw = 9 * scale, cr = 52 * scale
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath(); ctx.ellipse(sx + 4 * scale, sy + 2, cr * 0.75, 7 * scale, 0, 0, Math.PI * 2); ctx.fill()
    // Trunk
    ctx.fillStyle = '#3d2b1f'
    ctx.fillRect(sx - tw / 2, sy - h * 0.35, tw, h * 0.35)
    // Three layered triangles
    const layers = [
        { yFrac: 0.40, widMul: 1.0,  col: '#0a3d0a' },
        { yFrac: 0.60, widMul: 0.78, col: '#1a6b1a' },
        { yFrac: 0.80, widMul: 0.52, col: '#2aaa2a' },
    ]
    layers.forEach(({ yFrac, widMul, col }) => {
        const baseY = sy - h * (yFrac - 0.22)
        const tipY  = sy - h * (yFrac + 0.2)
        const hw    = cr * widMul
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.moveTo(sx, tipY)
        ctx.lineTo(sx + hw, baseY)
        ctx.lineTo(sx - hw, baseY)
        ctx.closePath(); ctx.fill()
    })
}

// ── Draw building ─────────────────────────────────────────────────────────────
const drawBuilding = (ctx, sx, sy, scale, alt) => {
    if (scale < 0.04 || sy < 0) return
    const bw = 72 * scale, bh = 130 * scale
    ctx.fillStyle = alt ? '#1e293b' : '#0f172a'
    ctx.fillRect(sx - bw / 2, sy - bh, bw, bh)
    const rows = Math.max(2, Math.floor(4 * scale))
    const cols = Math.max(2, Math.floor(3 * scale))
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if ((r + c + Math.round(sx)) % 3 !== 0) {
                ctx.fillStyle = 'rgba(255,220,80,0.55)'
                ctx.fillRect(
                    sx - bw / 2 + (c + 0.4) * bw / cols,
                    sy - bh + (r + 0.3) * bh / (rows + 1),
                    bw * 0.18, bh * 0.08
                )
            }
        }
    }
}

// ── Draw beautiful sunset sky ─────────────────────────────────────────────────
const drawSky = (ctx, W, horizonY) => {
    const grad = ctx.createLinearGradient(0, 0, 0, horizonY)
    grad.addColorStop(0,    '#07071a')
    grad.addColorStop(0.3,  '#1a0a40')
    grad.addColorStop(0.55, '#6b1a1a')
    grad.addColorStop(0.75, '#cc4400')
    grad.addColorStop(0.88, '#ff7700')
    grad.addColorStop(1,    '#ffcc33')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, horizonY)

    // Sun glow
    const sg = ctx.createRadialGradient(W / 2, horizonY, 0, W / 2, horizonY, W * 0.38)
    sg.addColorStop(0,    'rgba(255,230,80,0.95)')
    sg.addColorStop(0.12, 'rgba(255,140,0,0.7)')
    sg.addColorStop(0.35, 'rgba(200,50,0,0.35)')
    sg.addColorStop(1,    'rgba(0,0,0,0)')
    ctx.fillStyle = sg
    ctx.fillRect(0, horizonY - W * 0.38, W, W * 0.38)

    // Sun disc (half circle at horizon)
    ctx.fillStyle = '#ffe066'
    ctx.beginPath(); ctx.arc(W / 2, horizonY + 2, 30, Math.PI, 0); ctx.fill()

    // Stars (deterministic)
    for (let i = 0; i < 90; i++) {
        const stx  = (i * 137.508 + 73)  % W
        const sty  = (i * 73.137  + 17)  % (horizonY * 0.5)
        const br   = 0.25 + (i % 5) * 0.13
        ctx.fillStyle = `rgba(255,255,255,${br})`
        ctx.beginPath(); ctx.arc(stx, sty, i % 8 === 0 ? 1.5 : 0.8, 0, Math.PI * 2); ctx.fill()
    }

    // Distant mountain silhouette
    ctx.fillStyle = 'rgba(20,10,40,0.55)'
    ctx.beginPath()
    ctx.moveTo(0, horizonY)
    const peaks = [0.05, 0.18, 0.28, 0.42, 0.55, 0.68, 0.78, 0.90, 1.0]
    peaks.forEach((xf, idx) => {
        const peakH = horizonY * (0.06 + (idx % 3) * 0.04)
        ctx.lineTo(xf * W, horizonY - peakH)
        if (idx < peaks.length - 1) ctx.lineTo((xf + peaks[idx + 1]) / 2 * W, horizonY - peakH * 0.4)
    })
    ctx.lineTo(W, horizonY); ctx.closePath(); ctx.fill()
}

// ── Draw player car — rear‑view perspective ───────────────────────────────────
const drawPlayerCar = (ctx, cx, bottomY, lean, braking) => {
    ctx.save()
    ctx.translate(cx, bottomY)
    ctx.rotate((lean || 0) * Math.PI / 180)

    const bw = 94, bh = 52, cw = 58, ch = 38, wy = -bh + 4

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)'
    ctx.beginPath(); ctx.ellipse(0, 12, 56, 11, 0, 0, Math.PI * 2); ctx.fill()

    // Rear wheels (drawn first so body covers inner edges)
    const drawWheel = (wx) => {
        ctx.fillStyle = '#111'
        ctx.beginPath(); ctx.ellipse(wx, -15, 15, 20, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#777'
        ctx.beginPath(); ctx.ellipse(wx, -15, 9, 13, 0, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#444'; ctx.lineWidth = 1.5
        for (let s = 0; s < 5; s++) {
            const a = s * Math.PI * 2 / 5
            ctx.beginPath(); ctx.moveTo(wx, -15); ctx.lineTo(wx + Math.cos(a) * 9, -15 + Math.sin(a) * 13); ctx.stroke()
        }
        ctx.fillStyle = '#555'
        ctx.beginPath(); ctx.ellipse(wx, -15, 3, 4, 0, 0, Math.PI * 2); ctx.fill()
    }
    drawWheel(-bw / 2 - 9)
    drawWheel(bw / 2 + 9)

    // Lower body — lateral gradient for depth
    const bodyGrad = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0)
    bodyGrad.addColorStop(0,   '#a93226')
    bodyGrad.addColorStop(0.28,'#e74c3c')
    bodyGrad.addColorStop(0.72,'#e74c3c')
    bodyGrad.addColorStop(1,   '#a93226')
    ctx.fillStyle = bodyGrad
    ctx.beginPath()
    ctx.moveTo(-bw / 2, 0); ctx.lineTo(bw / 2, 0)
    ctx.lineTo(bw / 2 - 8, wy); ctx.lineTo(-bw / 2 + 8, wy)
    ctx.closePath(); ctx.fill()

    // Cabin
    const cabGrad = ctx.createLinearGradient(-cw / 2, wy, cw / 2, wy)
    cabGrad.addColorStop(0,   '#8e1a1a')
    cabGrad.addColorStop(0.5, '#c0392b')
    cabGrad.addColorStop(1,   '#8e1a1a')
    ctx.fillStyle = cabGrad
    ctx.beginPath()
    ctx.moveTo(-bw / 2 + 8, wy); ctx.lineTo(bw / 2 - 8, wy)
    ctx.lineTo(cw / 2, wy - ch); ctx.lineTo(-cw / 2, wy - ch)
    ctx.closePath(); ctx.fill()

    // Rear window glass
    const winGrad = ctx.createLinearGradient(0, wy - 4, 0, wy - ch + 8)
    winGrad.addColorStop(0, '#0d4f72')
    winGrad.addColorStop(1, '#1a7ab5')
    ctx.fillStyle = winGrad
    ctx.beginPath()
    ctx.moveTo(-bw / 2 + 22, wy - 5); ctx.lineTo(bw / 2 - 22, wy - 5)
    ctx.lineTo(cw / 2 - 8, wy - ch + 8); ctx.lineTo(-cw / 2 + 8, wy - ch + 8)
    ctx.closePath(); ctx.fill()
    // Glare
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    ctx.beginPath()
    ctx.moveTo(-bw / 2 + 22, wy - 5); ctx.lineTo(0, wy - 5)
    ctx.lineTo(-cw / 2 + 14, wy - ch + 10); ctx.lineTo(-cw / 2 + 8, wy - ch + 8)
    ctx.closePath(); ctx.fill()

    // Tail lights
    const tlC = braking ? '#ff2200' : '#880000'
    const tlG = braking ? 'rgba(255,80,0,0.55)' : 'rgba(180,0,0,0.28)'
    ;[[-bw / 2 + 5, 22], [bw / 2 - 27, 22]].forEach(([lx]) => {
        ctx.fillStyle = tlG
        ctx.beginPath(); ctx.roundRect(lx - 2, -23, 26, 14, 3); ctx.fill()
        ctx.fillStyle = tlC
        ctx.beginPath(); ctx.roundRect(lx, -20, 22, 10, 2); ctx.fill()
    })

    // Bumper
    ctx.fillStyle = '#444'
    ctx.beginPath(); ctx.roundRect(-bw / 2 + 10, -7, bw - 20, 7, 3); ctx.fill()

    // Exhaust pipes
    ctx.fillStyle = '#888'
    ctx.beginPath(); ctx.roundRect(-bw / 2 + 16, -1, 9, 4, 1); ctx.fill()
    ctx.beginPath(); ctx.roundRect(bw / 2 - 25, -1, 9, 4, 1); ctx.fill()

    // Spoiler
    ctx.fillStyle = '#222'
    ctx.fillRect(-cw / 2 - 15, wy - ch - 2, cw + 30, 5)
    ctx.fillRect(-cw / 2 - 5, wy - ch - 14, 7, 14)
    ctx.fillRect(cw / 2 - 2, wy - ch - 14, 7, 14)

    ctx.restore()
}

// ── Draw opponent car — same rear‑view, blue ──────────────────────────────────
const drawOpponentCar = (ctx, sx, sy, scale) => {
    if (scale < 0.04 || sy < 0) return
    ctx.save()
    ctx.translate(sx, sy)
    ctx.scale(scale, scale)

    const bw = 94, bh = 52, cw = 58, ch = 38, wy = -bh + 4

    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath(); ctx.ellipse(0, 12, 56, 11, 0, 0, Math.PI * 2); ctx.fill()

    const dw = (wx) => {
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(wx, -15, 15, 20, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = '#777'; ctx.beginPath(); ctx.ellipse(wx, -15, 9, 13, 0, 0, Math.PI * 2); ctx.fill()
    }
    dw(-bw / 2 - 9); dw(bw / 2 + 9)

    // Body
    const bg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0)
    bg.addColorStop(0, '#1a3a99'); bg.addColorStop(0.5, '#2255dd'); bg.addColorStop(1, '#1a3a99')
    ctx.fillStyle = bg
    ctx.beginPath(); ctx.moveTo(-bw / 2, 0); ctx.lineTo(bw / 2, 0); ctx.lineTo(bw / 2 - 8, wy); ctx.lineTo(-bw / 2 + 8, wy); ctx.closePath(); ctx.fill()

    ctx.fillStyle = '#1a3a99'
    ctx.beginPath(); ctx.moveTo(-bw / 2 + 8, wy); ctx.lineTo(bw / 2 - 8, wy); ctx.lineTo(cw / 2, wy - ch); ctx.lineTo(-cw / 2, wy - ch); ctx.closePath(); ctx.fill()

    ctx.fillStyle = '#0d4a6b'
    ctx.beginPath(); ctx.moveTo(-bw / 2 + 22, wy - 5); ctx.lineTo(bw / 2 - 22, wy - 5); ctx.lineTo(cw / 2 - 8, wy - ch + 8); ctx.lineTo(-cw / 2 + 8, wy - ch + 8); ctx.closePath(); ctx.fill()

    ctx.fillStyle = '#880000'
    ctx.beginPath(); ctx.roundRect(-bw / 2 + 5, -20, 22, 10, 2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(bw / 2 - 27, -20, 22, 10, 2); ctx.fill()

    ctx.fillStyle = '#444'; ctx.beginPath(); ctx.roundRect(-bw / 2 + 10, -7, bw - 20, 7, 3); ctx.fill()

    // Spoiler
    ctx.fillStyle = '#222'; ctx.fillRect(-cw / 2 - 15, wy - ch - 2, cw + 30, 5)
    ctx.restore()
}

// ── Speed lines effect ────────────────────────────────────────────────────────
const drawSpeedLines = (ctx, W, H, speed) => {
    if (speed < 200) return
    const intensity = Math.min(1, (speed - 200) / 300) * 0.22
    ctx.fillStyle = `rgba(255,220,130,${intensity})`
    for (let i = 0; i < 10; i++) {
        const x  = (i * 41 + Date.now() * 0.3) % (W * 0.28)
        const y  = (i * 73) % H
        const lh = 30 + (i % 4) * 25
        ctx.fillRect(x, y, 2, lh)
        ctx.fillRect(W - x - 2, y, 2, lh)
    }
}

// ── Main component ────────────────────────────────────────────────────────────
const RacingGamePage = () => {
    const { opponentId } = useParams()
    const navigate       = useNavigate()
    const location       = useLocation()
    const { user }       = useContext(UserContext)
    const { socket, endRaceGameOnNavigate, callUser, leaveCall, call, callAccepted, stream } = useContext(SocketContext) || {}

    const canvasRef       = useRef(null)
    const keysRef         = useRef({ up: false, down: false, left: false, right: false })
    const posRef          = useRef({ position: 0, x: 0, speed: 0, lap: 0 })
    const oppRef          = useRef({ position: 0, x: 0, speed: 0, lap: 0 })
    const animRef         = useRef(null)
    const lastTimeRef     = useRef(null)
    const syncTimerRef    = useRef(null)
    const previousPathRef = useRef(location.pathname)

    // ── roomId as STATE so countdown re‑triggers if it arrives after mount ──
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

    // ── If roomId arrives after mount (challenger receives acceptRaceChallenge) ─
    useEffect(() => {
        if (!socket) return
        const h = ({ roomId: rId }) => {
            if (rId) { localStorage.setItem('raceRoomId', rId); setRoomId(rId) }
        }
        socket.on('acceptRaceChallenge', h)
        return () => socket.off('acceptRaceChallenge', h)
    }, [socket])

    // ── Fetch opponent profile ────────────────────────────────────────────────
    useEffect(() => {
        if (!opponentId) return
        const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
        fetch(`${base}/api/user/getUserPro/${opponentId}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?._id) setOpponent(d) })
            .catch(() => {})
    }, [opponentId])

    useEffect(() => { if (callAccepted) setCallActive(true) }, [callAccepted])

    // ── Socket: pos updates, race result, opponent left ───────────────────────
    useEffect(() => {
        if (!socket || !roomId) return
        const onPos  = ({ position, x, speed, lap }) => { oppRef.current = { position, x, speed, lap }; setOppLap(lap) }
        const onRes  = ({ winnerId: w }) => { setWinnerId(w); setGameOver(true); cancelAnimationFrame(animRef.current); clearInterval(syncTimerRef.current) }
        const onLeft = () => { setGameOver(true); setWinnerId(user?._id); cancelAnimationFrame(animRef.current); clearInterval(syncTimerRef.current) }
        socket.on('raceOpponentPos', onPos)
        socket.on('raceResult',      onRes)
        socket.on('raceOpponentLeft', onLeft)
        return () => { socket.off('raceOpponentPos', onPos); socket.off('raceResult', onRes); socket.off('raceOpponentLeft', onLeft) }
    }, [socket, roomId, user?._id])

    // ── Countdown — starts as soon as roomId is available ────────────────────
    useEffect(() => {
        if (!roomId) return
        let c = 3
        setCountdown(c)
        const iv = setInterval(() => {
            c--
            setCountdown(c)
            if (c <= 0) { clearInterval(iv); setCountdown(null); setGameLive(true) }
        }, 1000)
        return () => clearInterval(iv)
    }, [roomId])

    // ── Keyboard ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const dn = (e) => {
            if (e.key==='ArrowUp'   ||e.key==='w'||e.key==='W') keysRef.current.up    = true
            if (e.key==='ArrowDown' ||e.key==='s'||e.key==='S') keysRef.current.down  = true
            if (e.key==='ArrowLeft' ||e.key==='a'||e.key==='A') keysRef.current.left  = true
            if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') keysRef.current.right = true
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault()
        }
        const up = (e) => {
            if (e.key==='ArrowUp'   ||e.key==='w'||e.key==='W') keysRef.current.up    = false
            if (e.key==='ArrowDown' ||e.key==='s'||e.key==='S') keysRef.current.down  = false
            if (e.key==='ArrowLeft' ||e.key==='a'||e.key==='A') keysRef.current.left  = false
            if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') keysRef.current.right = false
        }
        window.addEventListener('keydown', dn)
        window.addEventListener('keyup', up)
        return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
    }, [])

    // ── Main game loop ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!gameLive || gameOver) return
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        const W = canvas.width, H = canvas.height
        const HORIZON_Y = Math.round(H * 0.46)

        const loop = (ts) => {
            if (!lastTimeRef.current) lastTimeRef.current = ts
            const dt = Math.min((ts - lastTimeRef.current) / 1000, 0.05)
            lastTimeRef.current = ts

            // Physics
            const p    = posRef.current
            const keys = keysRef.current

            if (keys.up)        p.speed = Math.min(p.speed + ACCEL * dt, MAX_SPEED)
            else if (keys.down) p.speed = Math.max(p.speed - BRAKE * dt, -MAX_SPEED * 0.28)
            else                p.speed *= FRICTION

            const segIdx = Math.floor(p.position / SEG_LEN) % TOTAL_SEGS
            const curve  = TRACK[segIdx]?.curve || 0
            if (Math.abs(p.speed) > 0.1) p.x -= curve * (p.speed / MAX_SPEED) * CENTRIFUGAL * dt * 60
            if (keys.left)  p.x -= STEERING * (p.speed / MAX_SPEED) * dt
            if (keys.right) p.x += STEERING * (p.speed / MAX_SPEED) * dt
            p.x = Math.max(-2.5, Math.min(2.5, p.x))

            p.position += p.speed * dt
            if (p.position < 0) p.position = 0
            const lapLen = TOTAL_SEGS * SEG_LEN
            if (p.position >= lapLen * (p.lap + 1)) {
                p.lap++
                setMyLap(p.lap)
                if (p.lap >= TOTAL_LAPS && socket && roomId) {
                    socket.emit('raceFinished', { roomId, winnerId: user?._id, time: Date.now() })
                    setWinnerId(user?._id)
                    setGameOver(true)
                    cancelAnimationFrame(animRef.current)
                    clearInterval(syncTimerRef.current)
                    return
                }
            }
            setMySpeed(Math.round(Math.abs(p.speed)))

            // ── Render ──────────────────────────────────────────────────────
            ctx.clearRect(0, 0, W, H)
            drawSky(ctx, W, HORIZON_Y)

            const camZ = p.position
            const camX = 0

            // Collect projected points
            let xCurveAcc = 0, dxCurve = 0
            const points = []
            for (let i = 0; i < VISIBLE; i++) {
                const segI  = (Math.floor(camZ / SEG_LEN) + i) % TOTAL_SEGS
                const seg   = TRACK[segI]
                const wZ    = (Math.floor(camZ / SEG_LEN) + i) * SEG_LEN
                const nextY = TRACK[(segI + 1) % TOTAL_SEGS]?.y || 0
                const p1    = project(camX * ROAD_WIDTH, CAM_HEIGHT + seg.y, wZ,          0, 0, camZ, CAM_DEPTH, W, H, ROAD_WIDTH)
                const p2    = project(camX * ROAD_WIDTH, CAM_HEIGHT + nextY, wZ + SEG_LEN, 0, 0, camZ, CAM_DEPTH, W, H, ROAD_WIDTH)
                dxCurve    += seg.curve || 0
                xCurveAcc  += dxCurve
                const shiftedX = p1.sx + xCurveAcc * p1.scale * W * 0.5
                points.push({ seg, segI, p1, p2, shiftedX, wZ })
            }

            // Draw road back → front
            for (let i = VISIBLE - 1; i >= 0; i--) {
                const { p1, p2, shiftedX, wZ } = points[i]
                const alt  = Math.floor(wZ / SEG_LEN) % 2 === 0
                const fog  = Math.min(1, i / VISIBLE * 1.3) * 0.6
                const nextX = points[i + 1]?.shiftedX ?? p2.sx
                drawSegment(ctx, W,
                    { ...p1, sx: shiftedX },
                    { ...p2, sx: nextX },
                    alt, fog
                )
            }

            // Draw sprites front → back (so near ones cover far)
            for (let i = 0; i < VISIBLE; i++) {
                const { seg, p1, shiftedX } = points[i]
                if (!seg.sprites?.length) continue
                for (const spr of seg.sprites) {
                    const sprX  = shiftedX + spr.offset * p1.sw
                    const sprSc = p1.scale * spr.scale * 1.6
                    if (spr.type === 'tree')     drawTree(ctx, sprX, p1.sy, sprSc)
                    else drawBuilding(ctx, sprX, p1.sy, sprSc, seg.index % 2 === 0)
                }
            }

            // Opponent car
            const opp = oppRef.current
            const distSegs = Math.floor((opp.position - p.position) / SEG_LEN)
            if (distSegs >= 0 && distSegs < VISIBLE) {
                const pt = points[Math.max(0, distSegs)]
                if (pt) {
                    const oppSX = pt.shiftedX + opp.x * pt.p1.sw * 0.5
                    drawOpponentCar(ctx, oppSX, pt.p1.sy, Math.min(1.4, pt.p1.scale * 1.3 + 0.05))
                }
            }

            // Speed lines
            drawSpeedLines(ctx, W, H, Math.abs(p.speed))

            // Player car — rear view, leans on steer
            const lean  = keys.left ? -5 : keys.right ? 5 : 0
            const carX  = W / 2 + p.x * W * 0.055
            const carY  = H * 0.83
            drawPlayerCar(ctx, carX, carY, lean, keys.down || p.speed < 5)

            animRef.current = requestAnimationFrame(loop)
        }

        animRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(animRef.current)
    }, [gameLive, gameOver, socket, roomId, user?._id])

    // ── Position sync ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!gameLive || gameOver || !socket || !roomId) return
        syncTimerRef.current = setInterval(() => {
            const p = posRef.current
            socket.emit('racePosUpdate', { roomId, position: p.position, x: p.x, speed: p.speed, lap: p.lap })
        }, POS_SYNC_MS)
        return () => clearInterval(syncTimerRef.current)
    }, [gameLive, gameOver, socket, roomId])

    // ── Navigation guards ─────────────────────────────────────────────────────
    useEffect(() => {
        const onPop = () => { if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) endRaceGameOnNavigate() }
        window.addEventListener('popstate', onPop)
        return () => window.removeEventListener('popstate', onPop)
    }, [endRaceGameOnNavigate])

    useEffect(() => {
        const cur  = location.pathname
        const prev = previousPathRef.current
        if (prev.startsWith('/race/') && !cur.startsWith('/race/')) {
            if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) endRaceGameOnNavigate()
        }
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
        <Box position="fixed" inset={0} bg="#07071a" display="flex" flexDirection="column" overflow="hidden" userSelect="none">
            {/* Top HUD */}
            <Flex
                position="absolute" top={0} left={0} right={0}
                px={4} py={2} zIndex={20}
                justify="space-between" align="center"
                bg="rgba(0,0,0,0.6)"
                backdropFilter="blur(10px)"
                borderBottom="1px solid rgba(255,150,0,0.25)"
            >
                {/* Left */}
                <Flex align="center" gap={3}>
                    <Tooltip label="Leave race">
                        <IconButton icon={<IoArrowBack />} size="sm" variant="ghost"
                            color="white" onClick={handleLeave} aria-label="Leave"
                            _hover={{ bg: 'rgba(255,100,0,0.25)' }}
                        />
                    </Tooltip>
                    <Avatar size="sm" src={user?.profilePic} name={user?.name || user?.username}
                        border="2px solid #e74c3c" />
                    <Box>
                        <Text color="white" fontWeight="bold" fontSize="sm" lineHeight={1}>{user?.name || user?.username}</Text>
                        <Text color="#ff7700" fontSize="xs">Lap {Math.min(myLap + 1, TOTAL_LAPS)}/{TOTAL_LAPS}</Text>
                    </Box>
                </Flex>

                {/* Center speed */}
                <Flex direction="column" align="center">
                    <Text color="#ffcc33" fontWeight="black" fontSize="2xl" lineHeight={1}>{mySpeed}</Text>
                    <Text color="gray.400" fontSize="9px" letterSpacing="wider">KM/H</Text>
                </Flex>

                {/* Right */}
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
                            <IconButton
                                icon={(callActive || inCall) ? <FaPhoneSlash /> : <FaPhone />}
                                size="sm" colorScheme={(callActive || inCall) ? 'red' : 'green'}
                                onClick={handleCallBtn} aria-label="call" />
                        </Tooltip>
                    </Flex>
                </Flex>
            </Flex>

            {/* Canvas */}
            <canvas ref={canvasRef} width={900} height={540}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />

            {/* Key hints */}
            <Flex position="absolute" bottom={3} left={0} right={0} justify="center" gap={3} zIndex={10}>
                {['↑ / W  Accelerate', '↓ / S  Brake', '← / A  Left', '→ / D  Right'].map(k => (
                    <Badge key={k} bg="rgba(255,180,0,0.18)" color="rgba(255,220,100,0.9)"
                        px={2} py={1} borderRadius="md" fontSize="10px" border="1px solid rgba(255,150,0,0.3)">
                        {k}
                    </Badge>
                ))}
            </Flex>

            {/* Countdown overlay */}
            {countdown !== null && countdown > 0 && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center"
                    bg="rgba(0,0,0,0.65)" pointerEvents="none" flexDirection="column" gap={4}>
                    <Text fontSize="10px" color="rgba(255,200,100,0.7)" letterSpacing="widest" textTransform="uppercase">
                        Get Ready!
                    </Text>
                    <Text fontSize="120px" fontWeight="black" lineHeight={1}
                        color={countdown === 1 ? '#ff3300' : countdown === 2 ? '#ffcc00' : '#ffffff'}
                        style={{ textShadow: `0 0 60px ${countdown === 1 ? '#ff3300' : countdown === 2 ? '#ffcc00' : '#ffffff'}` }}>
                        {countdown}
                    </Text>
                </Flex>
            )}
            {countdown === 0 && !gameLive && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center"
                    bg="rgba(0,0,0,0.5)" pointerEvents="none">
                    <Text fontSize="90px" fontWeight="black" lineHeight={1} color="#33ff66"
                        style={{ textShadow: '0 0 50px #00ff44' }}>GO!</Text>
                </Flex>
            )}

            {/* Waiting for room */}
            {!roomId && !gameOver && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center" bg="rgba(0,0,0,0.82)">
                    <Box textAlign="center">
                        <Text fontSize="48px" mb={2}>🏎️</Text>
                        <Text color="white" fontSize="xl" fontWeight="bold" mb={2}>Waiting for race to start…</Text>
                        <Text color="rgba(255,150,0,0.7)" fontSize="sm">Connecting to opponent</Text>
                    </Box>
                </Flex>
            )}

            {/* Game over overlay */}
            {gameOver && (
                <Flex position="absolute" inset={0} zIndex={40} align="center" justify="center" bg="rgba(0,0,0,0.85)">
                    <Box
                        bg="linear-gradient(135deg,#1a0a2e,#2d1a0a)"
                        borderRadius="2xl" p={10} textAlign="center"
                        border="2px solid rgba(255,150,0,0.4)"
                        boxShadow="0 0 80px rgba(255,100,0,0.3)"
                        minW="340px"
                    >
                        {winnerId === user?._id ? (
                            <>
                                <FaTrophy size={60} color="#FFD700" style={{ margin: '0 auto 14px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="#FFD700" mb={2}>🏆 You Win!</Text>
                                <Text color="rgba(255,220,150,0.8)" mb={8}>You crossed the finish line first!</Text>
                            </>
                        ) : winnerId ? (
                            <>
                                <FaFlag size={52} color="#888" style={{ margin: '0 auto 14px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="gray.400" mb={2}>Race Over</Text>
                                <Text color="rgba(200,200,200,0.7)" mb={8}>Your opponent was faster this time.</Text>
                            </>
                        ) : (
                            <>
                                <FaFlag size={52} color="#e74c3c" style={{ margin: '0 auto 14px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="#e74c3c" mb={2}>Opponent Left</Text>
                                <Text color="rgba(200,200,200,0.7)" mb={8}>You win by default!</Text>
                            </>
                        )}
                        <Box as="button" px={10} py={3} borderRadius="xl"
                            bg="linear-gradient(90deg,#cc4400,#ff7700)"
                            color="white" fontWeight="bold" fontSize="md"
                            _hover={{ transform: 'scale(1.05)', opacity: 0.92 }}
                            transition="all 0.2s" onClick={handleLeave}>
                            Back to Home
                        </Box>
                    </Box>
                </Flex>
            )}
        </Box>
    )
}

export default RacingGamePage
