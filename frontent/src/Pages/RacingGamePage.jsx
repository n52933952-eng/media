import React, { useEffect, useRef, useState, useContext, useCallback } from 'react'
import { Box, Flex, Text, Avatar, Badge, IconButton, Tooltip, useColorModeValue } from '@chakra-ui/react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import API_BASE_URL from '../config/api'
import { FaPhone, FaPhoneSlash, FaMicrophone, FaMicrophoneSlash, FaFlag, FaTrophy } from 'react-icons/fa'
import { IoArrowBack } from 'react-icons/io5'

// ─── Road / physics constants ────────────────────────────────────────────────
const ROAD_WIDTH   = 2000
const SEG_LEN      = 200
const TOTAL_SEGS   = 600          // 1 lap = 600 * 200 = 120 000 units
const CAM_HEIGHT   = 1500
const CAM_DEPTH    = 0.84         // ~60 deg FOV
const VISIBLE      = 100          // segments rendered per frame
const MAX_SPEED    = 450
const ACCEL        = 220
const BRAKE        = 500
const FRICTION     = 0.97         // multiplier per frame (~60fps)
const STEERING     = 3.5
const TOTAL_LAPS   = 3
const CENTRIFUGAL  = 0.3          // how much curves push the car
const POS_SYNC_MS  = 80           // position broadcast interval

// ─── Visual palette ──────────────────────────────────────────────────────────
const C = {
    SKY_TOP:      '#0f172a',
    SKY_MID:      '#1e3a5f',
    SKY_BOT:      '#2d6a9f',
    HORIZON:      '#4a90d9',
    GRASS_D:      '#1a5c1a',
    GRASS_L:      '#22aa22',
    ROAD_D:       '#2a2a2e',
    ROAD_L:       '#363640',
    RUMBLE_R:     '#cc2222',
    RUMBLE_W:     '#eeeeee',
    LANE:         '#e0e0e0',
    TREE_TRUNK:   '#5c3317',
    TREE_CROWN:   '#1a6b1a',
    TREE_CROWN2:  '#26a226',
    BUILDING:     '#2c3e50',
    BUILDING2:    '#1a252f',
    SHADOW:       'rgba(0,0,0,0.25)',
}

// ─── Build track ─────────────────────────────────────────────────────────────
const buildTrack = () => {
    const segs = []
    for (let i = 0; i < TOTAL_SEGS; i++) {
        let curve = 0
        let y = 0
        // curves
        if (i > 40  && i < 120) curve = 2.2
        if (i > 150 && i < 220) curve = -2.5
        if (i > 260 && i < 330) curve = 1.8
        if (i > 380 && i < 450) curve = -2.0
        if (i > 480 && i < 560) curve = 2.5
        // gentle hills
        if (i > 100 && i < 180) y = Math.sin((i - 100) * 0.06) * 600
        if (i > 350 && i < 430) y = Math.sin((i - 350) * 0.07) * 500

        const sprites = []
        // Trees every 8 segments
        if (i % 8 === 0) {
            sprites.push({ offset:  2.8, type: 'tree',     scale: 0.9 + Math.random() * 0.4 })
            sprites.push({ offset: -2.8, type: 'tree',     scale: 0.9 + Math.random() * 0.4 })
        }
        // Extra trees staggered
        if (i % 12 === 6) {
            sprites.push({ offset:  3.5, type: 'tree',     scale: 0.7 + Math.random() * 0.3 })
            sprites.push({ offset: -3.5, type: 'tree',     scale: 0.7 + Math.random() * 0.3 })
        }
        // Buildings (less frequent)
        if (i % 40 === 20) {
            sprites.push({ offset:  5.5, type: 'building', scale: 1.2 + Math.random() * 0.6 })
            sprites.push({ offset: -5.5, type: 'building', scale: 1.2 + Math.random() * 0.6 })
        }
        segs.push({ index: i, curve, y, sprites })
    }
    return segs
}
const TRACK = buildTrack()

// ─── Project a world point to screen ─────────────────────────────────────────
const project = (worldX, worldY, worldZ, camX, camY, camZ, camDepth, W, H, roadW) => {
    const scale  = camDepth / (worldZ - camZ)
    const sx     = Math.round((W / 2) + scale * (worldX - camX) * W / 2)
    const sy     = Math.round((H / 2) - scale * (worldY - camY) * H / 2)
    const sw     = Math.round(scale * roadW * W / 2)
    return { sx, sy, sw, scale }
}

// ─── Draw a road trapezoid ────────────────────────────────────────────────────
const drawSegment = (ctx, W, seg, p1, p2, alt, fog, camY) => {
    const { sx: x1, sy: y1, sw: w1 } = p1
    const { sx: x2, sy: y2, sw: w2 } = p2

    const grass  = alt ? C.GRASS_D  : C.GRASS_L
    const road   = alt ? C.ROAD_D   : C.ROAD_L
    const rumble = alt ? C.RUMBLE_R : C.RUMBLE_W

    const poly = (col, ax, ay, bx, by, cx, cy, dx, dy) => {
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
        ctx.lineTo(cx, cy); ctx.lineTo(dx, dy)
        ctx.closePath(); ctx.fill()
    }

    // Grass strip full width
    poly(grass,   0, y2, W, y2, W, y1, 0, y1)
    // Road surface
    poly(road,    x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2)
    // Rumble strips (edge bands, 15% of road width)
    const rw1 = w1 * 0.15, rw2 = w2 * 0.15
    poly(rumble,  x1 - w1,       y1, x1 - w1 + rw1, y1, x2 - w2 + rw2, y2, x2 - w2,       y2)
    poly(rumble,  x1 + w1 - rw1, y1, x1 + w1,       y1, x2 + w2,       y2, x2 + w2 - rw2, y2)
    // Lane dashes (center, every other alt)
    if (!alt) {
        const lw1 = w1 * 0.04, lw2 = w2 * 0.04
        poly(C.LANE, x1 - lw1, y1, x1 + lw1, y1, x2 + lw2, y2, x2 - lw2, y2)
    }

    // Fog overlay
    if (fog > 0) {
        ctx.fillStyle = `rgba(15,23,42,${fog})`
        poly(null, 0, y2, W, y2, W, y1, 0, y1)
        ctx.fillStyle = `rgba(15,23,42,${fog})`
        ctx.beginPath()
        ctx.moveTo(0, y2); ctx.lineTo(W, y2)
        ctx.lineTo(W, y1); ctx.lineTo(0, y1)
        ctx.closePath(); ctx.fill()
    }
}

// ─── Draw a tree at screen coords ───────────────────────────────────────────
const drawTree = (ctx, sx, sy, scale) => {
    if (scale < 0.02 || sy < 0) return
    const h  = 160 * scale
    const tw = 12  * scale
    const cw = 54  * scale
    const ch = 80  * scale
    // Shadow
    ctx.fillStyle = C.SHADOW
    ctx.beginPath()
    ctx.ellipse(sx + 6*scale, sy + 4*scale, cw * 0.7, ch * 0.2, 0, 0, Math.PI * 2)
    ctx.fill()
    // Trunk
    ctx.fillStyle = C.TREE_TRUNK
    ctx.fillRect(sx - tw/2, sy - h * 0.42, tw, h * 0.42)
    // Dark base crown
    ctx.fillStyle = C.TREE_CROWN
    ctx.beginPath()
    ctx.ellipse(sx, sy - h * 0.52, cw * 0.68, ch * 0.6, 0, 0, Math.PI * 2)
    ctx.fill()
    // Bright highlight
    ctx.fillStyle = C.TREE_CROWN2
    ctx.beginPath()
    ctx.ellipse(sx - cw*0.18, sy - h * 0.63, cw * 0.42, ch * 0.42, -0.3, 0, Math.PI * 2)
    ctx.fill()
}

// ─── Draw a building at screen coords ───────────────────────────────────────
const drawBuilding = (ctx, sx, sy, scale, alt) => {
    if (scale < 0.03 || sy < 0) return
    const bw = 80  * scale
    const bh = 130 * scale
    ctx.fillStyle = alt ? C.BUILDING : C.BUILDING2
    ctx.fillRect(sx - bw/2, sy - bh, bw, bh)
    // Windows
    ctx.fillStyle = 'rgba(255,220,80,0.7)'
    const rows = Math.max(2, Math.floor(4 * scale))
    const cols = Math.max(2, Math.floor(3 * scale))
    const ww = bw * 0.18, wh = bh * 0.1
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (Math.random() > 0.3) {
                ctx.fillRect(
                    sx - bw/2 + (c + 0.35) * bw / (cols),
                    sy - bh + (r + 0.3) * bh / (rows),
                    ww, wh
                )
            }
        }
    }
}

// ─── Draw sky gradient ────────────────────────────────────────────────────────
const drawSky = (ctx, W, H) => {
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.55)
    grad.addColorStop(0,   C.SKY_TOP)
    grad.addColorStop(0.5, C.SKY_MID)
    grad.addColorStop(1,   C.SKY_BOT)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H * 0.55)
    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    for (let i = 0; i < 60; i++) {
        const sx = (i * 137.508 % W)
        const sy = (i * 73.137 % (H * 0.45))
        const r  = i % 5 === 0 ? 1.2 : 0.7
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
    }
}

// ─── Draw the player car ─────────────────────────────────────────────────────
const drawPlayerCar = (ctx, cx, cy, color = '#e63946') => {
    const W = 64, H = 96
    const x = cx - W/2, y = cy - H * 0.6
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(cx, cy + 10, W * 0.55, 10, 0, 0, Math.PI * 2); ctx.fill()
    // Body
    ctx.fillStyle = color
    ctx.beginPath(); ctx.roundRect(x, y, W, H, 10); ctx.fill()
    // Stripe
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fillRect(cx - 4, y, 8, H)
    // Windshield
    ctx.fillStyle = '#7ed6ff'
    ctx.beginPath(); ctx.roundRect(x + 10, y + 12, W - 20, H * 0.28, 4); ctx.fill()
    // Rear window
    ctx.fillStyle = '#7ed6ff'
    ctx.beginPath(); ctx.roundRect(x + 12, y + H * 0.6, W - 24, H * 0.18, 4); ctx.fill()
    // Tires
    ctx.fillStyle = '#111'
    const tyres = [
        [x - 10, y + 8], [x + W + 2, y + 8],
        [x - 10, y + H - 26], [x + W + 2, y + H - 26],
    ]
    tyres.forEach(([tx, ty]) => {
        ctx.beginPath(); ctx.roundRect(tx, ty, 12, 20, 3); ctx.fill()
        ctx.fillStyle = '#555'; ctx.beginPath()
        ctx.roundRect(tx + 2, ty + 3, 8, 14, 2); ctx.fill()
        ctx.fillStyle = '#111'
    })
    // Headlights
    ctx.fillStyle = '#fff9c4'
    ctx.beginPath(); ctx.roundRect(x + 6, y + 2, 16, 8, 2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(x + W - 22, y + 2, 16, 8, 2); ctx.fill()
    // Tail lights
    ctx.fillStyle = '#ff3333'
    ctx.beginPath(); ctx.roundRect(x + 6, y + H - 10, 16, 8, 2); ctx.fill()
    ctx.beginPath(); ctx.roundRect(x + W - 22, y + H - 10, 16, 8, 2); ctx.fill()
}

// ─── Draw opponent car at a projected position ───────────────────────────────
const drawOpponentCar = (ctx, sx, sy, scale, color = '#3a86ff') => {
    if (scale < 0.05 || sy < 0) return
    const W = 64 * scale, H = 96 * scale
    const x = sx - W/2, y = sy - H * 0.8
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath(); ctx.ellipse(sx, sy + 4*scale, W * 0.55, 6*scale, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath(); ctx.roundRect(x, y, W, H, 8 * scale); ctx.fill()
    ctx.fillStyle = '#7ed6ff'
    ctx.beginPath(); ctx.roundRect(x + W*0.15, y + H*0.12, W*0.7, H*0.28, 3*scale); ctx.fill()
    ctx.fillStyle = '#111'
    const tyres = [
        [x - 6*scale, y + 6*scale], [x + W + 2*scale, y + 6*scale],
        [x - 6*scale, y + H - 22*scale], [x + W + 2*scale, y + H - 22*scale],
    ]
    tyres.forEach(([tx, ty]) => {
        ctx.beginPath(); ctx.roundRect(tx, ty, 9*scale, 16*scale, 2*scale); ctx.fill()
    })
    ctx.fillStyle = '#ff3333'
    ctx.beginPath(); ctx.roundRect(x + W*0.1, y + H - 8*scale, W*0.25, 5*scale, 1*scale); ctx.fill()
    ctx.beginPath(); ctx.roundRect(x + W*0.65, y + H - 8*scale, W*0.25, 5*scale, 1*scale); ctx.fill()
}

// ─── Main component ──────────────────────────────────────────────────────────
const RacingGamePage = () => {
    const { opponentId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const { user } = useContext(UserContext)
    const { socket, endRaceGameOnNavigate, callUser, leaveCall, call, callAccepted, stream } = useContext(SocketContext)

    const canvasRef    = useRef(null)
    const keysRef      = useRef({ up: false, down: false, left: false, right: false })
    const posRef       = useRef({ position: 0, x: 0, speed: 0, lap: 0 })
    const oppRef       = useRef({ position: 0, x: 0, speed: 0, lap: 0 })
    const animRef      = useRef(null)
    const lastTimeRef  = useRef(null)
    const syncTimerRef = useRef(null)
    const previousPathRef = useRef(null)

    const roomId = localStorage.getItem('raceRoomId')

    const [opponent,    setOpponent]    = useState(null)
    const [gameLive,    setGameLive]    = useState(false)
    const [gameOver,    setGameOver]    = useState(false)
    const [winnerId,    setWinnerId]    = useState(null)
    const [myLap,       setMyLap]       = useState(0)
    const [oppLap,      setOppLap]      = useState(0)
    const [mySpeed,     setMySpeed]     = useState(0)
    const [countdown,   setCountdown]   = useState(3)
    const [isMuted,     setIsMuted]     = useState(false)
    const [inCall,      setInCall]      = useState(false)
    const [callActive,  setCallActive]  = useState(false)

    const bgCard    = useColorModeValue('rgba(255,255,255,0.9)', 'rgba(15,23,42,0.92)')
    const textCol   = useColorModeValue('#1a202c', '#e2e8f0')
    const accentCol = '#e63946'

    // Fetch opponent profile
    useEffect(() => {
        if (!opponentId) return
        const base = API_BASE_URL || (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')
        fetch(`${base}/api/user/getUserPro/${opponentId}`, { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?._id) setOpponent(d) })
            .catch(() => {})
    }, [opponentId])

    // Sync callAccepted into local state
    useEffect(() => {
        if (callAccepted) setCallActive(true)
    }, [callAccepted])

    // Socket: position updates, race result, opponent left
    useEffect(() => {
        if (!socket || !roomId) return

        const handleOppPos = ({ position, x, speed, lap }) => {
            oppRef.current = { position, x, speed, lap }
            setOppLap(lap)
        }
        const handleResult = ({ winnerId: w }) => {
            setWinnerId(w)
            setGameOver(true)
            cancelAnimationFrame(animRef.current)
            clearInterval(syncTimerRef.current)
        }
        const handleOppLeft = () => {
            setGameOver(true)
            setWinnerId(user?._id)
            cancelAnimationFrame(animRef.current)
            clearInterval(syncTimerRef.current)
        }

        socket.on('raceOpponentPos', handleOppPos)
        socket.on('raceResult',      handleResult)
        socket.on('raceOpponentLeft', handleOppLeft)

        return () => {
            socket.off('raceOpponentPos', handleOppPos)
            socket.off('raceResult',      handleResult)
            socket.off('raceOpponentLeft', handleOppLeft)
        }
    }, [socket, roomId, user?._id])

    // Countdown then start
    useEffect(() => {
        if (!roomId) return
        let c = 3
        setCountdown(c)
        const iv = setInterval(() => {
            c--
            setCountdown(c)
            if (c <= 0) {
                clearInterval(iv)
                setCountdown(null)
                setGameLive(true)
            }
        }, 1000)
        return () => clearInterval(iv)
    }, [roomId])

    // Keyboard listeners
    useEffect(() => {
        const down = (e) => {
            if (e.key === 'ArrowUp'    || e.key === 'w' || e.key === 'W') keysRef.current.up    = true
            if (e.key === 'ArrowDown'  || e.key === 's' || e.key === 'S') keysRef.current.down  = true
            if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keysRef.current.left  = true
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRef.current.right = true
        }
        const up = (e) => {
            if (e.key === 'ArrowUp'    || e.key === 'w' || e.key === 'W') keysRef.current.up    = false
            if (e.key === 'ArrowDown'  || e.key === 's' || e.key === 'S') keysRef.current.down  = false
            if (e.key === 'ArrowLeft'  || e.key === 'a' || e.key === 'A') keysRef.current.left  = false
            if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRef.current.right = false
        }
        window.addEventListener('keydown', down)
        window.addEventListener('keyup',   up)
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
    }, [])

    // Game loop
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

            // ── Physics ──
            const p = posRef.current
            const keys = keysRef.current

            if (keys.up)   p.speed = Math.min(p.speed + ACCEL * dt, MAX_SPEED)
            else if (keys.down) p.speed = Math.max(p.speed - BRAKE * dt, -MAX_SPEED * 0.3)
            else           p.speed *= FRICTION

            // Centrifugal push from curves
            const segIdx = Math.floor(p.position / SEG_LEN) % TOTAL_SEGS
            const curve  = TRACK[segIdx]?.curve || 0
            if (Math.abs(p.speed) > 0.1) {
                p.x -= curve * p.speed / MAX_SPEED * CENTRIFUGAL * dt * 60
            }

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

            // ── Render ──
            ctx.clearRect(0, 0, W, H)
            drawSky(ctx, W, H)

            const camZ   = p.position
            const camX   = p.x
            const camY   = CAM_HEIGHT

            // Project and draw road segments back-to-front
            let x = 0        // accumulated curve X
            let dx = 0

            // Two-pass: first collect projected points, then draw back-to-front
            const points = []
            for (let i = 0; i < VISIBLE; i++) {
                const segI = (Math.floor(camZ / SEG_LEN) + i) % TOTAL_SEGS
                const seg  = TRACK[segI]
                const wZ   = (Math.floor(camZ / SEG_LEN) + i) * SEG_LEN
                const p1   = project(camX * ROAD_WIDTH, camY + seg.y, wZ,           0, 0, camZ, CAM_DEPTH, W, H, ROAD_WIDTH)
                const p2   = project(camX * ROAD_WIDTH, camY + (TRACK[(segI + 1) % TOTAL_SEGS]?.y || 0), wZ + SEG_LEN, 0, 0, camZ, CAM_DEPTH, W, H, ROAD_WIDTH)
                dx += (seg.curve || 0)
                x  += dx
                points.push({ seg, segI, p1, p2, x: p1.sx + x * p1.scale * W * 0.5, wZ })
            }

            // Draw farthest first (index VISIBLE-1 down to 0)
            for (let i = VISIBLE - 1; i >= 0; i--) {
                const { seg, p1, p2, x: xOff } = points[i]
                const alt = Math.floor(points[i].wZ / SEG_LEN) % 2 === 0
                const fog = Math.min(1, i / VISIBLE * 1.2) * 0.55
                const sp1 = { ...p1, sx: xOff }
                const sp2 = { ...p2, sx: (points[i + 1]?.x || p2.sx) }
                drawSegment(ctx, W, seg, sp1, sp2, alt, fog, camY)
            }

            // Sprites (trees, buildings) front-to-back so near ones overdraw far
            for (let i = 0; i < VISIBLE; i++) {
                const { seg, p1, x: xOff } = points[i]
                if (!seg.sprites || seg.sprites.length === 0) continue
                for (const spr of seg.sprites) {
                    const sprSX = xOff + spr.offset * p1.sw
                    const sprScale = p1.scale * spr.scale * 1.5
                    if (spr.type === 'tree') drawTree(ctx, sprSX, p1.sy, sprScale)
                    else drawBuilding(ctx, sprSX, p1.sy, sprScale, seg.index % 2 === 0)
                }
            }

            // Opponent car — find projected position based on distance
            const opp = oppRef.current
            const distSegs = Math.floor((opp.position - p.position) / SEG_LEN)
            if (distSegs > 0 && distSegs < VISIBLE) {
                const pt = points[distSegs]
                if (pt) {
                    const oppSX = pt.x + opp.x * pt.p1.sw
                    drawOpponentCar(ctx, oppSX, pt.p1.sy, pt.p1.scale * 1.2)
                }
            }

            // Player car (bottom center, slight x offset by steering)
            const carX = W / 2 + (p.x * W * 0.06)
            const carY = H * 0.82
            drawPlayerCar(ctx, carX, carY, accentCol)

            animRef.current = requestAnimationFrame(loop)
        }

        animRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(animRef.current)
    }, [gameLive, gameOver, socket, roomId, user?._id])

    // Position sync interval
    useEffect(() => {
        if (!gameLive || gameOver || !socket || !roomId) return
        syncTimerRef.current = setInterval(() => {
            const p = posRef.current
            socket.emit('racePosUpdate', { roomId, position: p.position, x: p.x, speed: p.speed, lap: p.lap })
        }, POS_SYNC_MS)
        return () => clearInterval(syncTimerRef.current)
    }, [gameLive, gameOver, socket, roomId])

    // Back-button + location-change guard (same pattern as chess/cards)
    useEffect(() => {
        if (previousPathRef.current === null) previousPathRef.current = location.pathname

        const onPopState = () => {
            if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) endRaceGameOnNavigate()
        }
        window.addEventListener('popstate', onPopState)

        const cur  = location.pathname
        const prev = previousPathRef.current
        if (prev?.startsWith('/race/') && !cur.startsWith('/race/') && prev !== cur) {
            if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) endRaceGameOnNavigate()
        }
        previousPathRef.current = cur

        return () => window.removeEventListener('popstate', onPopState)
    }, [location.pathname, endRaceGameOnNavigate])

    // Unmount guard
    useEffect(() => {
        return () => {
            if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) {
                setTimeout(() => {
                    if (!window.location.pathname.startsWith('/race/')) endRaceGameOnNavigate()
                }, 50)
            }
        }
    }, [endRaceGameOnNavigate])

    const handleLeave = useCallback(() => {
        if (inCall || callActive) leaveCall()
        if (endRaceGameOnNavigate) endRaceGameOnNavigate()
        navigate('/home')
    }, [endRaceGameOnNavigate, navigate, inCall, callActive, leaveCall])

    const handleCallBtn = () => {
        if (callActive || inCall) {
            leaveCall()
            setCallActive(false)
            setInCall(false)
        } else {
            callUser(opponentId, 'audio')
            setInCall(true)
        }
    }

    const toggleMute = () => {
        if (stream) {
            stream.getAudioTracks().forEach(t => { t.enabled = isMuted })
        }
        setIsMuted(m => !m)
    }

    const lapLen = TOTAL_SEGS * SEG_LEN
    const myPct  = roomId ? Math.min(100, (posRef.current.position % lapLen) / lapLen * 100) : 0

    return (
        <Box
            position="fixed" inset={0}
            bg={C.SKY_TOP}
            display="flex" flexDirection="column"
            overflow="hidden"
            userSelect="none"
        >
            {/* Top HUD bar */}
            <Flex
                position="absolute" top={0} left={0} right={0}
                px={4} py={2} zIndex={20}
                justify="space-between" align="center"
                bg="rgba(0,0,0,0.55)"
                backdropFilter="blur(8px)"
            >
                {/* Left: back button + player info */}
                <Flex align="center" gap={3}>
                    <Tooltip label="Leave race">
                        <IconButton
                            icon={<IoArrowBack />}
                            size="sm"
                            variant="ghost"
                            colorScheme="whiteAlpha"
                            color="white"
                            onClick={handleLeave}
                            aria-label="Leave"
                        />
                    </Tooltip>
                    <Avatar size="sm" src={user?.profilePic} name={user?.name || user?.username} />
                    <Box>
                        <Text color="white" fontWeight="bold" fontSize="sm" lineHeight={1}>
                            {user?.name || user?.username}
                        </Text>
                        <Text color="green.300" fontSize="xs">
                            Lap {Math.min(myLap + 1, TOTAL_LAPS)}/{TOTAL_LAPS}
                        </Text>
                    </Box>
                </Flex>

                {/* Center: speed */}
                <Flex direction="column" align="center">
                    <Text color="white" fontWeight="black" fontSize="2xl" lineHeight={1}>
                        {mySpeed}
                    </Text>
                    <Text color="gray.400" fontSize="9px" letterSpacing="wider">KM/H</Text>
                </Flex>

                {/* Right: opponent + voice call */}
                <Flex align="center" gap={3}>
                    <Box textAlign="right">
                        <Text color="white" fontWeight="bold" fontSize="sm" lineHeight={1}>
                            {opponent?.name || opponent?.username || 'Opponent'}
                        </Text>
                        <Text color="blue.300" fontSize="xs">
                            Lap {Math.min(oppLap + 1, TOTAL_LAPS)}/{TOTAL_LAPS}
                        </Text>
                    </Box>
                    <Avatar size="sm" src={opponent?.profilePic} name={opponent?.name || opponent?.username} />

                    {/* Voice call button */}
                    <Flex gap={1}>
                        {(callActive || inCall) && (
                            <Tooltip label={isMuted ? 'Unmute' : 'Mute'}>
                                <IconButton
                                    icon={isMuted ? <FaMicrophoneSlash /> : <FaMicrophone />}
                                    size="sm"
                                    colorScheme={isMuted ? 'red' : 'green'}
                                    onClick={toggleMute}
                                    aria-label="mute"
                                />
                            </Tooltip>
                        )}
                        <Tooltip label={(callActive || inCall) ? 'End call' : 'Voice call with opponent'}>
                            <IconButton
                                icon={(callActive || inCall) ? <FaPhoneSlash /> : <FaPhone />}
                                size="sm"
                                colorScheme={(callActive || inCall) ? 'red' : 'green'}
                                onClick={handleCallBtn}
                                aria-label="call"
                            />
                        </Tooltip>
                    </Flex>
                </Flex>
            </Flex>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                width={800}
                height={500}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                }}
            />

            {/* Controls hint */}
            <Flex
                position="absolute" bottom={3} left={0} right={0}
                justify="center" gap={4} zIndex={10}
            >
                {['↑ / W', '↓ / S', '← / A', '→ / D'].map(k => (
                    <Badge key={k} colorScheme="whiteAlpha" bg="rgba(255,255,255,0.15)" color="white" px={2} py={1} borderRadius="md" fontSize="xs">
                        {k}
                    </Badge>
                ))}
            </Flex>

            {/* Countdown overlay */}
            {countdown !== null && countdown > 0 && (
                <Flex
                    position="absolute" inset={0} zIndex={30}
                    align="center" justify="center"
                    bg="rgba(0,0,0,0.6)"
                    pointerEvents="none"
                >
                    <Text
                        fontSize="120px"
                        fontWeight="black"
                        color={countdown === 1 ? 'red.400' : countdown === 2 ? 'yellow.300' : 'white'}
                        style={{ textShadow: '0 0 40px rgba(255,255,255,0.6)', lineHeight: 1 }}
                    >
                        {countdown}
                    </Text>
                </Flex>
            )}
            {countdown === 0 && !gameLive && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center" bg="rgba(0,0,0,0.4)" pointerEvents="none">
                    <Text fontSize="80px" fontWeight="black" color="green.300" style={{ textShadow: '0 0 30px lime', lineHeight: 1 }}>
                        GO!
                    </Text>
                </Flex>
            )}

            {/* No room fallback */}
            {!roomId && !gameOver && (
                <Flex position="absolute" inset={0} zIndex={30} align="center" justify="center" bg="rgba(0,0,0,0.8)">
                    <Box textAlign="center">
                        <Text color="white" fontSize="xl" mb={4}>Waiting for race to start…</Text>
                        <Text color="gray.400" fontSize="sm">Challenge your opponent first</Text>
                    </Box>
                </Flex>
            )}

            {/* Game over overlay */}
            {gameOver && (
                <Flex position="absolute" inset={0} zIndex={40} align="center" justify="center" bg="rgba(0,0,0,0.8)">
                    <Box
                        bg={bgCard} borderRadius="2xl" p={10} textAlign="center"
                        boxShadow="0 0 60px rgba(230,57,70,0.4)" minW="320px"
                    >
                        {winnerId === user?._id ? (
                            <>
                                <FaTrophy size={56} color="#FFD700" style={{ margin: '0 auto 12px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="yellow.400" mb={2}>You Win!</Text>
                                <Text color={textCol} mb={6}>Congratulations! You finished first.</Text>
                            </>
                        ) : winnerId ? (
                            <>
                                <FaFlag size={48} color="#999" style={{ margin: '0 auto 12px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="gray.400" mb={2}>Race Over</Text>
                                <Text color={textCol} mb={6}>Your opponent crossed the finish line first.</Text>
                            </>
                        ) : (
                            <>
                                <FaFlag size={48} color="#e63946" style={{ margin: '0 auto 12px' }} />
                                <Text fontSize="3xl" fontWeight="black" color="red.400" mb={2}>Opponent Left</Text>
                                <Text color={textCol} mb={6}>You win by default!</Text>
                            </>
                        )}
                        <Box
                            as="button"
                            px={8} py={3} borderRadius="xl"
                            bg={accentCol} color="white" fontWeight="bold" fontSize="md"
                            _hover={{ bg: '#c1121f', transform: 'scale(1.04)' }}
                            transition="all 0.2s"
                            onClick={handleLeave}
                        >
                            Back to Home
                        </Box>
                    </Box>
                </Flex>
            )}
        </Box>
    )
}

export default RacingGamePage
