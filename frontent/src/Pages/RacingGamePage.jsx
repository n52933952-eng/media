import React, { useEffect, useRef, useState, useContext, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Room, RoomEvent } from 'livekit-client'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { UserContext } from '../context/UserContext'
import { SocketContext } from '../context/SocketContext'
import { LiveKitContext } from '../context/LiveKitContext'
import API_BASE_URL from '../config/api'
import raceStartSfx from '../assets/start.mp3'
import raceLoopMusic from '../assets/k.mp3'
import goSfx from '../assets/go.mp3'
import raceMusicFile from '../assets/rasemusic.mp3'
import { initPhysics, updatePhysics, FIXED_PHYSICS_STEP } from '../game/racing/physics.js'
import { createVehicle, updateSteering, resetCarPosition, updateCarPosition } from '../game/racing/car.js'
import { loadTrackModel, loadMapDecorations, checkGroundCollision } from '../game/racing/track.js'
import { loadGates, updateGateFading, checkGateProximity, showFinishMessage } from '../game/racing/gates.js'

// ─── Camera constants (same as reference game) ───────────────────────────────
const CAMERA_DISTANCE  = 10
const CAMERA_HEIGHT    = 5
const CAMERA_LERP      = 0.1
const CAMERA_LOOK_AHEAD = 2
const MAX_SPEED_KPH    = 200
const DEFAULT_MAP      = 'map1'

/** World-space half spacing between host (left lane) and guest at the start line — car centers, meters */
const START_LINE_LANE_OFFSET = 1.85

/** Pixels from top of viewport — must clear fixed app header (~72px) + gap so HUD is not hidden under it */
const RACE_TOP_OFFSET_PX = 88

/** If socket drops, wait for reconnect this long before leaving the race (ms) */
const RACE_DISCONNECT_GRACE_MS = 12000

/** If the second player never joins the room, auto-exit (ms) */
const RACE_WAIT_OPPONENT_MS = 120000
/** Hard disconnect timeout before force exit (ms) */
const RACE_HARD_DISCONNECT_EXIT_MS = 45000

/** Match SocketContext / backend: ids may be ObjectId or string */
function userIdToStr(id) {
  if (id == null || id === '') return ''
  if (typeof id === 'string') return id.trim()
  if (typeof id === 'object' && id != null && typeof id.toString === 'function') return String(id.toString()).trim()
  return String(id).trim()
}

export default function RacingGamePage() {
  const { opponentId } = useParams()
  const navigate       = useNavigate()
  const location       = useLocation()
  const { user }       = useContext(UserContext)
  const { socket, endRaceGameOnNavigate } = useContext(SocketContext) || {}
  const { incomingCall, declineCall } = useContext(LiveKitContext) || {}

  // ── UI state ────────────────────────────────────────────────────────────────
  const [loading,       setLoading]       = useState(true)
  const [loadingPct,    setLoadingPct]    = useState(0)
  const [loadingPhase,  setLoadingPhase]  = useState('engine') // 'engine' | 'assets' | 'error'
  const [countdown,     setCountdown]     = useState(null)
  const [speed,         setSpeed]         = useState(0)
  const [myGate,        setMyGate]        = useState(0)
  const [oppGate,       setOppGate]       = useState(0)
  const [raceTime,      setRaceTime]      = useState('00:00')
  const [raceFinished,  setRaceFinished]  = useState(false)
  const [winner,        setWinner]        = useState(null)
  const [opponent,      setOpponent]      = useState(null)
  const [waitingOpp,    setWaitingOpp]    = useState(true)
  const [callActive,    setCallActive]    = useState(false)
  const [muted,         setMuted]         = useState(false)
  const [voiceConnecting, setVoiceConnecting] = useState(false)
  /** Drives React re-renders when the race clock starts (avoid relying on raceStateRef in JSX). */
  const [raceLive,      setRaceLive]      = useState(false)
  const [reconnecting,  setReconnecting]  = useState(false)

  // ── Three.js / physics refs ─────────────────────────────────────────────────
  const containerRef   = useRef(null)
  const rendererRef    = useRef(null)
  const sceneRef       = useRef(null)
  const cameraRef      = useRef(null)
  const clockRef       = useRef(new THREE.Clock())
  const physicsRef     = useRef(null)        // { physicsWorld, tmpTrans }
  const carBodyRef     = useRef(null)
  const vehicleRef     = useRef(null)
  const wheelMeshesRef = useRef([])
  const carModelRef    = useRef(null)
  const oppModelRef    = useRef(null)
  const gateDataRef    = useRef(null)
  const steeringRef    = useRef(0)
  const keyStateRef    = useRef({ w:false, s:false, a:false, d:false })
  const accumRef       = useRef(0)
  const afRef          = useRef(null)
  const raceStateRef   = useRef({ isMultiplayer:true, raceStarted:false, raceFinished:false, countdownStarted:false, allPlayersConnected:false })
  const startTimeRef   = useRef(0)
  const timerRef       = useRef(null)
  const finishTimesRef = useRef({})
  const roomIdRef      = useRef(null)
  const isHostRef      = useRef(false)
  const myColorRef     = useRef('blue')
  const oppColorRef    = useRef('red')
  const prevPathRef    = useRef(location.pathname)
  const minimapRef     = useRef(null)  // { canvas, ctx, trackData }
  const carFlipRef     = useRef({ isFlipped:false, time:0, prevUpDot:1 })
  const oppTargetPosRef  = useRef(new THREE.Vector3(0, 100, 0))
  const oppTargetQuatRef = useRef(new THREE.Quaternion(0, 0, 0, 1))
  const oppSlerpTempRef  = useRef(new THREE.Quaternion())
  /** Last displayed speed — avoid setState 60×/s (causes layout jitter / “page jumping”) */
  const lastSpeedDispRef = useRef(-1)
  // Pre-allocated Vector3 objects to avoid per-frame GC pressure
  const _camDir        = useRef(new THREE.Vector3())
  const _camOffset     = useRef(new THREE.Vector3())
  const _camTarget     = useRef(new THREE.Vector3())
  const _flipUp        = useRef(new THREE.Vector3())
  const _flipAxis      = useRef(new THREE.Vector3(0, 1, 0))
  const resizeCleanupRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const raceVoiceRoomRef = useRef(null)
  /** Prevents double teardown / navigate when disconnect + opponentLeft both fire */
  const raceExitHandledRef = useRef(false)
  const exitRaceAndGoHomeRef = useRef(() => {})
  const raceEndSentRef = useRef(false)
  const assetsReadyRef = useRef(false)
  const raceReadySentRef = useRef(false)
  const bothPlayersReadyRef = useRef(false)
  const startSfxRef = useRef(null)
  const raceMusicRef = useRef(null)

  // ─── Fetch opponent profile ────────────────────────────────────────────────
  useEffect(() => {
    if (!opponentId) return
    fetch(`${API_BASE_URL}/api/user/getUserPro/${opponentId}`, { credentials:'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setOpponent(d) })
      .catch(() => {})
  }, [opponentId])

  // ─── Determine isHost and car colors ──────────────────────────────────────
  useEffect(() => {
    const roomId  = localStorage.getItem('raceRoomId')
    const isHost  = localStorage.getItem('raceIsHost') === 'true'
    roomIdRef.current  = roomId || ''
    isHostRef.current  = isHost
    myColorRef.current  = isHost ? 'blue' : 'red'
    oppColorRef.current = isHost ? 'red'  : 'blue'
  }, [user])

  // Hard guard: race route must have an active race room id.
  // After refresh/unload we intentionally clear `raceRoomId`; without this guard
  // the page can rebuild a local-only scene and look like it "returned to game".
  useEffect(() => {
    if (!user?._id) return
    const roomId = localStorage.getItem('raceRoomId')
    if (!roomId) {
      navigate('/', { replace: true })
    }
  }, [user?._id, navigate])

  /** End race locally, notify server, clear storage, go home — safe if socket is dead */
  const exitRaceAndGoHome = useCallback(() => {
    if (raceExitHandledRef.current) return
    raceExitHandledRef.current = true
    try {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    } catch (_) { /* ignore */ }
    try {
      if (raceVoiceRoomRef.current) {
        raceVoiceRoomRef.current.disconnect().catch(() => {})
        raceVoiceRoomRef.current = null
      }
    } catch (_) { /* ignore */ }
    try { setCallActive(false) } catch (_) { /* ignore */ }
    try {
      if (startSfxRef.current) {
        startSfxRef.current.pause()
        startSfxRef.current.currentTime = 0
      }
      if (raceMusicRef.current) {
        raceMusicRef.current.pause()
        raceMusicRef.current.currentTime = 0
      }
    } catch (_) { /* ignore */ }
    try {
      raceStateRef.current.raceFinished = true
      raceStateRef.current.raceStarted = false
    } catch (_) { /* ignore */ }
    try { endRaceGameOnNavigate?.() } catch (_) { /* ignore */ }
    try { navigate('/', { replace: true }) } catch (_) { /* ignore */ }
  }, [navigate, endRaceGameOnNavigate])

  useEffect(() => {
    exitRaceAndGoHomeRef.current = exitRaceAndGoHome
  }, [exitRaceAndGoHome])

  // ─── Lock page scroll while racing (mobile + desktop) — reduces viewport jump ─
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow
    const prevBody = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prevHtml
      document.body.style.overflow = prevBody
    }
  }, [])

  // ─── Load Ammo.js dynamically, then boot the game ─────────────────────────
  useEffect(() => {
    if (!user?._id) return
    let cancelled = false

    const boot = (AmmoLib) => {
      if (cancelled) return
      window.Ammo = AmmoLib
      setLoadingPhase('assets')
      initGame()
    }

    // Robust init — handles Promise, non-Promise, and already-initialized cases
    const runAmmo = (AmmoFn) => {
      try {
        const result = AmmoFn()
        if (result && typeof result.then === 'function') {
          result.then(boot).catch(() => { if (!cancelled) setLoadingPhase('error') })
        } else {
          boot(result || AmmoFn)
        }
      } catch (e) {
        if (!cancelled) setLoadingPhase('error')
      }
    }

    // 90-second safety timeout (Render.com cold starts can be slow)
    const timeoutId = setTimeout(() => {
      if (!cancelled) setLoadingPhase('error')
    }, 90000)

    if (window.Ammo && typeof window.Ammo === 'object') {
      clearTimeout(timeoutId)
      boot(window.Ammo)
    } else if (window.Ammo && typeof window.Ammo === 'function') {
      runAmmo(window.Ammo)
    } else {
      const tag = document.createElement('script')
      tag.src = '/ammo.js'
      tag.onload  = () => runAmmo(window.Ammo)
      tag.onerror = () => { if (!cancelled) setLoadingPhase('error') }
      document.head.appendChild(tag)
    }

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id])

  // ─── Socket.IO multiplayer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !roomIdRef.current) return

    // Join the race room with a fresh socket room membership
    try {
      if (socket.connected) {
        socket.emit('joinRaceRoom', { roomId: roomIdRef.current })
      }
    } catch (_) { /* ignore */ }

    const maybeStartCountdown = () => {
      if (!isHostRef.current) return
      if (!assetsReadyRef.current) return
      if (!raceStateRef.current.allPlayersConnected) return
      if (!bothPlayersReadyRef.current) return
      if (raceStateRef.current.countdownStarted) return
      raceStateRef.current.countdownStarted = true
      startCountdown()
      socket.emit('raceCountdownStart', { roomId: roomIdRef.current })
    }

    const onPlayerJoined = ({ count }) => {
      const hasBoth = count >= 2
      setWaitingOpp(!hasBoth)
      raceStateRef.current.allPlayersConnected = hasBoth
      if (hasBoth) lastOpponentPosAtRef.current = Date.now()
      maybeStartCountdown()
    }

    const onCountdownStart = () => {
      if (!isHostRef.current && !raceStateRef.current.countdownStarted) {
        raceStateRef.current.countdownStarted = true
        setWaitingOpp(false)
        startCountdown()
      }
    }

    const onRaceReadyState = ({ bothReady }) => {
      bothPlayersReadyRef.current = !!bothReady
      maybeStartCountdown()
    }

    const onOpponentPos = (data) => {
      updateOpponentCarPosition(data)
      if (data.raceProgress) setOppGate(data.raceProgress.currentGateIndex || 0)
    }

    const onRaceResult = ({ winnerId }) => {
      const myId = userIdToStr(user?._id)
      const winId = userIdToStr(winnerId)
      setWinner(winId && winId === myId ? 'you' : 'opponent')
      setRaceFinished(true)
      raceStateRef.current.raceFinished = true
      if (timerRef.current) clearInterval(timerRef.current)
      try {
        if (raceMusicRef.current) {
          raceMusicRef.current.pause()
          raceMusicRef.current.currentTime = 0
        }
      } catch (_) { /* ignore */ }
    }

    const onOpponentLeft = () => {
      // Opponent quit or server ended the room — clear everything and go home (no stuck overlay)
      try {
        setLoading(false)
        setLoadingPhase('assets')
      } catch (_) { /* ignore */ }
      exitRaceAndGoHome()
    }

    socket.on('racePlayerJoined',  onPlayerJoined)
    socket.on('raceCountdownStart', onCountdownStart)
    socket.on('raceOpponentPos',   onOpponentPos)
    socket.on('raceResult',        onRaceResult)
    socket.on('raceOpponentLeft',  onOpponentLeft)
    socket.on('raceReadyState',    onRaceReadyState)

    return () => {
      socket.off('racePlayerJoined',  onPlayerJoined)
      socket.off('raceCountdownStart', onCountdownStart)
      socket.off('raceOpponentPos',   onOpponentPos)
      socket.off('raceResult',        onRaceResult)
      socket.off('raceOpponentLeft',  onOpponentLeft)
      socket.off('raceReadyState',    onRaceReadyState)
    }
  }, [socket, user?._id, exitRaceAndGoHome])

  // Declare this client "ready" only after race assets are fully loaded.
  useEffect(() => {
    if (!socket || !user?._id || !roomIdRef.current) return
    if (loading) return
    if (raceReadySentRef.current) return
    if (!socket.connected) return
    assetsReadyRef.current = true
    raceReadySentRef.current = true
    socket.emit('racePlayerReady', { roomId: roomIdRef.current, userId: user._id })
  }, [socket, user?._id, loading])

  // ─── Connection lost: leave race after grace (reconnect clears the timer) ───
  useEffect(() => {
    if (!socket) return
    let disconnectTimer = null
    const onDisconnect = () => {
      setReconnecting(true)
      if (disconnectTimer) clearTimeout(disconnectTimer)
      disconnectTimer = setTimeout(() => {
        if (!socket.connected) {
          disconnectTimer = setTimeout(() => {
            if (!socket.connected) exitRaceAndGoHomeRef.current?.()
          }, RACE_HARD_DISCONNECT_EXIT_MS)
        }
      }, RACE_DISCONNECT_GRACE_MS)
    }
    const onConnect = () => {
      setReconnecting(false)
      if (disconnectTimer) {
        clearTimeout(disconnectTimer)
        disconnectTimer = null
      }
      try {
        const rid = roomIdRef.current || localStorage.getItem('raceRoomId')
        if (rid && socket.connected) {
          socket.emit('joinRaceRoom', { roomId: rid })
          if (!loading && user?._id) {
            assetsReadyRef.current = true
            socket.emit('racePlayerReady', { roomId: rid, userId: user._id })
          }
        }
      } catch (_) { /* ignore */ }
    }
    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)
    return () => {
      setReconnecting(false)
      if (disconnectTimer) clearTimeout(disconnectTimer)
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
    }
  }, [socket, loading, user?._id])

  // ─── Opponent never joins — avoid infinite "Waiting..." ─────────────────────
  useEffect(() => {
    if (loading || !waitingOpp || raceExitHandledRef.current) return
    if (!localStorage.getItem('raceRoomId')) return
    const t = setTimeout(() => {
      exitRaceAndGoHomeRef.current?.()
    }, RACE_WAIT_OPPONENT_MS)
    return () => clearTimeout(t)
  }, [loading, waitingOpp])

  // If any normal direct call appears while racing, auto-decline immediately.
  // Race page uses its own dedicated voice channel below.
  useEffect(() => {
    if (!incomingCall) return
    try { declineCall?.() } catch (_) { /* ignore */ }
  }, [incomingCall, declineCall])

  // ─── Race-only voice channel (separate from normal call system) ─────────────
  const connectRaceVoice = useCallback(async () => {
    if (voiceConnecting || callActive) return
    if (!user?._id || !opponentId) return
    setVoiceConnecting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/call/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'direct', targetId: opponentId }),
      })
      const data = await res.json()
      if (!res.ok || !data?.token || !data?.livekitUrl) {
        throw new Error(data?.error || 'Failed to create race voice session')
      }

      const room = new Room({ adaptiveStream: true, dynacast: true })
      raceVoiceRoomRef.current = room

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track?.kind !== 'audio') return
        const el = remoteAudioRef.current
        if (!el) return
        try {
          track.attach(el)
          el.volume = 1
          el.setAttribute('playsinline', 'true')
          el.setAttribute('webkit-playsinline', 'true')
          el.play?.().catch(() => {})
        } catch (_) { /* ignore */ }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        const el = remoteAudioRef.current
        if (!el || !track || track.kind !== 'audio') return
        try { track.detach(el) } catch (_) { /* ignore */ }
        try { el.srcObject = null } catch (_) { /* ignore */ }
      })

      room.on(RoomEvent.Disconnected, () => {
        setCallActive(false)
      })

      await room.connect(data.livekitUrl, data.token)
      await room.localParticipant.setCameraEnabled(false).catch(() => {})
      await room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
      setMuted(false)
      setCallActive(true)
    } catch (e) {
      try {
        raceVoiceRoomRef.current?.disconnect?.()
      } catch (_) {}
      raceVoiceRoomRef.current = null
      setCallActive(false)
    } finally {
      setVoiceConnecting(false)
    }
  }, [voiceConnecting, callActive, user?._id, opponentId])

  const disconnectRaceVoice = useCallback(() => {
    try {
      raceVoiceRoomRef.current?.disconnect?.()
    } catch (_) { /* ignore */ }
    raceVoiceRoomRef.current = null
    setCallActive(false)
    setMuted(false)
    const el = remoteAudioRef.current
    if (el) {
      try { el.srcObject = null } catch (_) { /* ignore */ }
    }
  }, [])

  // ─── Keyboard controls ──────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e) => {
      if (e.key==='w'||e.key==='ArrowUp')    keyStateRef.current.w = true
      if (e.key==='s'||e.key==='ArrowDown')  keyStateRef.current.s = true
      if (e.key==='a'||e.key==='ArrowLeft')  keyStateRef.current.a = true
      if (e.key==='d'||e.key==='ArrowRight') keyStateRef.current.d = true
      if (e.key==='r') resetCar()
    }
    const up = (e) => {
      if (e.key==='w'||e.key==='ArrowUp')    keyStateRef.current.w = false
      if (e.key==='s'||e.key==='ArrowDown')  keyStateRef.current.s = false
      if (e.key==='a'||e.key==='ArrowLeft')  keyStateRef.current.a = false
      if (e.key==='d'||e.key==='ArrowRight') keyStateRef.current.d = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // ─── Position broadcast ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!socket || !carModelRef.current || !roomIdRef.current) return
      if (!raceStateRef.current.raceStarted) return
      const gd = gateDataRef.current
      let distToGate = 1000000
      if (gd?.gates && gd.currentGateIndex < gd.gates.length) {
        const g = gd.gates[gd.currentGateIndex]
        if (g) {
          const gp = new THREE.Vector3(); g.getWorldPosition(gp)
          const dx = carModelRef.current.position.x - gp.x
          const dy = carModelRef.current.position.y - gp.y
          const dz = carModelRef.current.position.z - gp.z
          distToGate = dx*dx + dy*dy + dz*dz
        }
      }
      const pos = carModelRef.current.position
      const quat = carModelRef.current.quaternion
      try {
        if (socket?.connected) {
          socket.emit('racePosUpdate', {
            roomId: roomIdRef.current,
            position:   { x:+pos.x.toFixed(2),  y:+pos.y.toFixed(2),  z:+pos.z.toFixed(2)  },
            quaternion: { x:+quat.x.toFixed(4), y:+quat.y.toFixed(4), z:+quat.z.toFixed(4), w:+quat.w.toFixed(4)||1 },
            raceProgress: { currentGateIndex: gd?.currentGateIndex||0, distanceToNextGate: distToGate },
            ...(raceStateRef.current.raceFinished && finishTimesRef.current[user?._id]
              ? { finishTime: finishTimesRef.current[user._id] }
              : {}),
          })
        }
      } catch (_) { /* ignore — socket may be closing */ }
    }, 80)
    return () => clearInterval(id)
  }, [socket, user?._id])

  // ─── Navigation guard ───────────────────────────────────────────────────────
  useEffect(() => {
    // Browser back/forward button (SPA navigation)
    const onPop = () => {
      if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) {
        endRaceGameOnNavigate()
      }
    }
    // Tab close or hard refresh — emit synchronously then let page unload
    const onBeforeUnload = (e) => {
      const roomId = localStorage.getItem('raceRoomId')
      if (roomId && socket) {
        const match = roomId.match(/^race_(.+?)_(.+?)_\d+$/)
        if (match) {
          socket.emit('raceGameEnd', { roomId, player1: match[1], player2: match[2] })
        } else {
          socket.emit('raceGameEnd', { roomId })
        }
        localStorage.removeItem('raceRoomId')
      }
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [endRaceGameOnNavigate, socket])

  useEffect(() => {
    if (location.pathname !== prevPathRef.current && !location.pathname.startsWith('/race/')) {
      if (localStorage.getItem('raceRoomId') && endRaceGameOnNavigate) endRaceGameOnNavigate()
    }
    prevPathRef.current = location.pathname
  }, [location.pathname, endRaceGameOnNavigate])

  // Safety: if this page unmounts (logout / auth redirect / app shell remount),
  // end race once so both players are cleaned up server-side.
  useEffect(() => {
    return () => {
      if (raceEndSentRef.current) return
      const activeRoom = localStorage.getItem('raceRoomId')
      if (activeRoom && endRaceGameOnNavigate) {
        raceEndSentRef.current = true
        endRaceGameOnNavigate()
      }
    }
  }, [endRaceGameOnNavigate])

  // ─── GAME INIT ──────────────────────────────────────────────────────────────
  const initGame = useCallback(() => {
    const container = containerRef.current
    if (!container || !window.Ammo) return

    const tryStart = () => {
      const W = container.clientWidth
      const H = container.clientHeight
      // Wait until flex / fixed layout has real dimensions (avoids half-width canvas + black bar)
      if (W < 16 || H < 16) {
        requestAnimationFrame(tryStart)
        return
      }
      startGame(W, H)
    }

    const startGame = (W, H) => {

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    sceneRef.current = scene
    setupSkybox(scene)
    setupLighting(scene)

    // ── Camera ─────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(45, W/H, 0.5, 20000)
    camera.position.set(0, 10, 20)
    cameraRef.current = camera

    // ── Renderer ───────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio <= 1,
      logarithmicDepthBuffer: true,
    })
    // Cap at 2x DPR — going higher gives diminishing visual returns but costs GPU hard
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    // No light has castShadow=true so keep shadowMap off to save GPU bandwidth
    renderer.shadowMap.enabled = false
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current || !container) return
      const w = container.clientWidth
      const h = container.clientHeight
      if (w < 8 || h < 8) return
      cameraRef.current.aspect = w / h
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(w, h)
    }
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => onResize())
      ro.observe(container)
    } else {
      window.addEventListener('resize', onResize)
    }
    resizeCleanupRef.current = () => {
      if (ro) {
        ro.disconnect()
        ro = null
      } else {
        window.removeEventListener('resize', onResize)
      }
    }

    // ── Physics ────────────────────────────────────────────────────────────
    const physics = initPhysics(window.Ammo)
    physicsRef.current = physics

    // ── Loading manager ────────────────────────────────────────────────────
    const lm = new THREE.LoadingManager()
    lm.onProgress = (_, loaded, total) => setLoadingPct(Math.round(loaded/total*100))
    lm.onLoad = () => setLoading(false)
    window.loadingManager = lm

    // ── Globals for game modules ───────────────────────────────────────────
    window.raceState        = raceStateRef.current
    window.playerFinishTimes = finishTimesRef.current
    window.startCountdown   = startCountdown
    window.updateLeaderboard = () => {}  // no-op; we use React state

    // ── GameConfig for car.js color detection ──────────────────────────────
    const roomId = roomIdRef.current
    sessionStorage.setItem('gameConfig', JSON.stringify({
      roomId,
      players: [
        { id: user._id,    playerColor: myColorRef.current,  isHost:  isHostRef.current },
        { id: opponentId,  playerColor: oppColorRef.current, isHost: !isHostRef.current },
      ],
    }))
    localStorage.setItem('myPlayerId', user._id)

    // ── Track ──────────────────────────────────────────────────────────────
    loadTrackModel(window.Ammo, DEFAULT_MAP, scene, physics.physicsWorld, lm, (trackModel) => {
      if (trackModel) { /* minimap could use this */ }
    })
    loadMapDecorations(DEFAULT_MAP, scene, renderer, camera, lm)

    // ── Gates ──────────────────────────────────────────────────────────────
    const syncStartLineFromGate0 = (gateData) => {
      const g0 = gateData?.gates?.[0]
      if (!g0) return
      g0.updateMatrixWorld(true)
      g0.getWorldPosition(gateData.currentGatePosition)
      g0.getWorldQuaternion(gateData.currentGateQuaternion)
    }

    const snapPlayerToStartLine = () => {
      const gd = gateDataRef.current
      if (!gd?.gates?.[0] || !window.Ammo || !carBodyRef.current || !vehicleRef.current) return
      syncStartLineFromGate0(gd)
      const lane = isHostRef.current ? START_LINE_LANE_OFFSET : -START_LINE_LANE_OFFSET
      steeringRef.current = resetCarPosition(
        window.Ammo,
        carBodyRef.current,
        vehicleRef.current,
        steeringRef.current,
        gd.currentGatePosition,
        gd.currentGateQuaternion,
        lane
      )
    }

    const gd = loadGates(DEFAULT_MAP, scene, lm, (loaded) => {
      gateDataRef.current = loaded
      window.gateData = loaded
      syncStartLineFromGate0(loaded)
      snapPlayerToStartLine()
    })
    gateDataRef.current = gd
    window.gateData = gd

    // ── Player car (with physics) ───────────────────────────────────────────
    const carComps = createVehicle(window.Ammo, scene, physics.physicsWorld, [], (loaded) => {
      carBodyRef.current  = loaded.carBody
      vehicleRef.current  = loaded.vehicle
      wheelMeshesRef.current = loaded.wheelMeshes
      carModelRef.current    = loaded.carModel
      steeringRef.current    = loaded.currentSteeringAngle

      snapPlayerToStartLine()

      // ── Opponent car (visual only, no physics) ─────────────────────────
      loadOpponentCar(scene)

      // ── Minimap ────────────────────────────────────────────────────────
      initMinimap()

      // ── Start render loop ──────────────────────────────────────────────
      animate()
    }, myColorRef.current)
    carBodyRef.current = carComps.carBody
    vehicleRef.current = carComps.vehicle
    }

    tryStart()
  }, [user, opponentId])

  // ─── Opponent car (visual only) ────────────────────────────────────────────
  const loadOpponentCar = (scene) => {
    const loader = new GLTFLoader()
    loader.load(`/models/car_${oppColorRef.current}.glb`, (gltf) => {
      // cloneSkeleton() deep-clones skinned / rigged GLTFs; plain .clone() can break
      // wheels/body hierarchy and leave parts at wrong scale (tiny detached wheels).
      const model = cloneSkeleton(gltf.scene)
      model.scale.set(4, 4, 4)
      model.position.set(0, 0, 0)
      model.updateMatrixWorld(true)
      // Slight tint only — do not clone materials on SkinnedMesh (breaks skinning)
      model.traverse((n) => {
        if (n.isMesh && n.material && !n.isSkinnedMesh) {
          const mats = Array.isArray(n.material) ? n.material : [n.material]
          const cloned = mats.map((m) => {
            const c = m.clone()
            c.transparent = true
            c.opacity = 0.95
            return c
          })
          n.material = cloned.length === 1 ? cloned[0] : cloned
        }
      })
      const root = new THREE.Group()
      root.name = 'opponentCarRoot'
      root.position.set(0, 100, 0) // hide until first network update
      root.add(model)
      scene.add(root)
      oppModelRef.current = root
    })
  }

  // ─── Update opponent car position from socket data ─────────────────────────
  const updateOpponentCarPosition = (data) => {
    const model = oppModelRef.current
    if (!model || !data) return
    // Web format: { position, quaternion } — mobile (legacy) could send flat x/y/z at top level
    const pos =
      data.position ||
      (data.x !== undefined && data.y !== undefined && data.z !== undefined
        ? { x: +data.x, y: +data.y, z: +data.z }
        : null)
    if (!pos) return
    const px = +pos.x
    const py = +pos.y
    const pz = +pos.z
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return
    model.visible = true
    oppTargetPosRef.current.set(px, py, pz)
    const q =
      data.quaternion ||
      (data.qx !== undefined
        ? { x: +data.qx, y: +data.qy, z: +data.qz, w: +(data.qw ?? 1) }
        : null)
    if (q) {
      const qx = +q.x
      const qy = +q.y
      const qz = +q.z
      const qw = +(q.w ?? 1)
      if (Number.isFinite(qx) && Number.isFinite(qy) && Number.isFinite(qz) && Number.isFinite(qw)) {
        oppTargetQuatRef.current.set(qx, qy, qz, qw)
        oppTargetQuatRef.current.normalize()
      }
    }
  }

  // ─── Skybox (cartoon gradient — matches reference game) ───────────────────
  const setupSkybox = (scene) => {
    const geo = new THREE.SphereGeometry(1000, 32, 32)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        topColor:    { value: new THREE.Color(0x88ccff) },
        bottomColor: { value: new THREE.Color(0xbbe2ff) },
        offset:      { value: 0 },
        exponent:    { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 bottomColor;
        uniform float offset; uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          float t = max(pow(max(h,0.0), exponent), 0.0);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }`,
      side: THREE.BackSide,
    })
    scene.add(new THREE.Mesh(geo, mat))
  }

  // ─── Lighting (matches reference game) ────────────────────────────────────
  const setupLighting = (scene) => {
    scene.add(new THREE.AmbientLight(0xcccccc, 2))
    const sun = new THREE.DirectionalLight(0xffffff, 3.5)
    sun.position.set(40, 250, 30)
    scene.add(sun)
  }

  // ─── Countdown (3 → 2 → 1 → GO!) ─────────────────────────────────────────
  const startCountdown = useCallback(() => {
    let val = 3
    setCountdown(val)
    const id = setInterval(() => {
      val--
      if (val > 0) {
        setCountdown(val)
      } else if (val === 0) {
        setCountdown('GO!')
      } else {
        clearInterval(id)
        setCountdown(null)
        raceStateRef.current.raceStarted = true
        setRaceLive(true)
        try {
          if (!startSfxRef.current) startSfxRef.current = new Audio(goSfx || raceStartSfx)
          startSfxRef.current.currentTime = 0
          startSfxRef.current.play().catch(() => {})
          if (!raceMusicRef.current) {
            raceMusicRef.current = new Audio(raceMusicFile || raceLoopMusic)
            raceMusicRef.current.loop = true
            raceMusicRef.current.volume = 0.4
          }
          setTimeout(() => {
            raceMusicRef.current?.play?.().catch(() => {})
          }, 650)
        } catch (_) { /* ignore */ }
        // Start race timer
        startTimeRef.current = Date.now()
        timerRef.current = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
          const m = String(Math.floor(elapsed/60)).padStart(2,'0')
          const s = String(elapsed%60).padStart(2,'0')
          setRaceTime(`${m}:${s}`)
        }, 1000)
      }
    }, 1000)
  }, [])

  // ─── Reset car to last gate ────────────────────────────────────────────────
  const resetCar = () => {
    if (!window.Ammo || !carBodyRef.current || !gateDataRef.current) return
    const lane = isHostRef.current ? START_LINE_LANE_OFFSET : -START_LINE_LANE_OFFSET
    steeringRef.current = resetCarPosition(
      window.Ammo, carBodyRef.current, vehicleRef.current, steeringRef.current,
      gateDataRef.current.currentGatePosition, gateDataRef.current.currentGateQuaternion,
      lane
    )
  }

  // ─── Camera follow ─────────────────────────────────────────────────────────
  const updateCamera = () => {
    const cam = cameraRef.current
    const car = carModelRef.current
    if (!cam || !car) return
    // Reuse pre-allocated vectors to avoid GC pressure
    car.getWorldDirection(_camDir.current)
    _camOffset.current.copy(_camDir.current).multiplyScalar(-CAMERA_DISTANCE)
    _camTarget.current.copy(car.position).add(_camOffset.current)
    _camTarget.current.y += CAMERA_HEIGHT
    cam.position.lerp(_camTarget.current, CAMERA_LERP)
    _camOffset.current.copy(_camDir.current).multiplyScalar(CAMERA_LOOK_AHEAD)
    _camOffset.current.add(car.position)
    cam.lookAt(_camOffset.current)
  }

  // ─── Car flip check (auto-reset) ───────────────────────────────────────────
  const checkFlipped = (dt) => {
    const car = carModelRef.current
    if (!car) return
    _flipUp.current.copy(_flipAxis.current).applyQuaternion(car.quaternion)
    const dot = _flipUp.current.dot(_flipAxis.current)
    const f = carFlipRef.current
    if (dot < 0.45 && Math.abs(dot - f.prevUpDot) < 0.015) {
      f.isFlipped = true
      f.time += dt
      if (f.time > 0.85) { f.isFlipped = false; f.time = 0; resetCar() }
    } else {
      f.isFlipped = false; f.time = 0
    }
    f.prevUpDot = dot
  }

  // ─── Speedometer ───────────────────────────────────────────────────────────
  // Cache DOM refs so we don't query the DOM 60× per second
  const speedoElemsRef = useRef({ fill: null, needle: null, val: null })
  const updateSpeedDisplay = (kph) => {
    const pct = Math.min(kph / MAX_SPEED_KPH, 1)
    const rot = pct * 180
    const disp = Math.round(Math.max(kph - 1, 0))
    const e = speedoElemsRef.current
    if (!e.fill)   e.fill   = document.querySelector('.race-gauge-fill')
    if (!e.needle) e.needle = document.querySelector('.race-gauge-needle')
    if (!e.val)    e.val    = document.querySelector('.race-speed-value')
    if (e.fill)   e.fill.style.transform   = `rotate(${rot}deg)`
    if (e.needle) e.needle.style.transform = `rotate(${rot - 90}deg)`
    if (e.val)    e.val.textContent = String(disp)
    if (lastSpeedDispRef.current !== disp) {
      lastSpeedDispRef.current = disp
      setSpeed(disp)
    }
  }

  // ─── Minimap (simple 2D canvas) ────────────────────────────────────────────
  const initMinimap = () => {
    const host = containerRef.current
    if (!host) return
    const canvas = document.createElement('canvas')
    canvas.id = 'race-minimap'
    canvas.width  = 160; canvas.height = 160
    Object.assign(canvas.style, {
      position: 'absolute', bottom: '240px', right: '20px',
      width: '160px', height: '160px',
      background: 'rgba(0,0,0,0.5)', borderRadius: '50%',
      boxShadow: '0 0 10px rgba(0,0,0,0.7)', zIndex: '1000',
      pointerEvents: 'none',
    })
    host.appendChild(canvas)
    minimapRef.current = { canvas, ctx: canvas.getContext('2d') }
  }

  const drawMinimap = () => {
    const mm = minimapRef.current
    const car = carModelRef.current
    if (!mm || !car) return
    const { ctx } = mm
    const S = 160; const CX = S/2; const CY = S/2; const SCALE = 0.3
    ctx.clearRect(0, 0, S, S)
    // Circle clip
    ctx.save()
    ctx.beginPath(); ctx.arc(CX, CY, CX-2, 0, Math.PI*2); ctx.clip()
    // Background
    ctx.fillStyle = 'rgba(20,20,20,0.8)'; ctx.fillRect(0,0,S,S)
    // Draw player dot
    const px = CX + car.position.x * SCALE
    const py = CY - car.position.z * SCALE
    ctx.fillStyle = myColorRef.current === 'blue' ? '#4dc9ff' : '#ff4444'
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI*2); ctx.fill()
    // Draw opponent dot
    const opp = oppModelRef.current
    if (opp && opp.visible) {
      const ox = CX + opp.position.x * SCALE
      const oy = CY - opp.position.z * SCALE
      ctx.fillStyle = oppColorRef.current === 'blue' ? '#4dc9ff' : '#ff4444'
      ctx.beginPath(); ctx.arc(ox, oy, 6, 0, Math.PI*2); ctx.fill()
    }
    ctx.restore()
  }

  // ─── Main render loop ───────────────────────────────────────────────────────
  const animate = useCallback(() => {
    afRef.current = requestAnimationFrame(animate)
    try {
      const dt = Math.min(clockRef.current.getDelta(), 0.1)
      accumRef.current += dt

      const phys = physicsRef.current
      if (!phys) return

      // Clamp accumulated time — prevents "spiral of death" when a frame takes too long
      accumRef.current = Math.min(accumRef.current, FIXED_PHYSICS_STEP * 4)

      while (accumRef.current >= FIXED_PHYSICS_STEP) {
        const result = updatePhysics(
          FIXED_PHYSICS_STEP, window.Ammo,
          phys,
          {
            carBody: carBodyRef.current,
            vehicle: vehicleRef.current,
            carModel: carModelRef.current,
            wheelMeshes: wheelMeshesRef.current,
            keyState: keyStateRef.current,
            currentSteeringAngle: steeringRef.current,
            updateSteering,
          },
          [],
          raceStateRef.current
        )
        if (result) {
          updateSpeedDisplay(result.currentSpeed || 0)
          steeringRef.current = result.currentSteeringAngle ?? steeringRef.current
        }

        updateCarPosition(window.Ammo, vehicleRef.current, carModelRef.current, wheelMeshesRef.current)

        checkGroundCollision(window.Ammo, carBodyRef.current, () => resetCar())
        checkFlipped(FIXED_PHYSICS_STEP)
        updateCamera()

        // Gate check
        if (gateDataRef.current && carModelRef.current) {
          const finished = checkGateProximity(carModelRef.current, gateDataRef.current)
          window.gateData = gateDataRef.current
          setMyGate(gateDataRef.current.currentGateIndex || 0)
          if (finished && !raceStateRef.current.raceFinished) {
            raceStateRef.current.raceFinished = true
            const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
            const m = String(Math.floor(elapsed/60)).padStart(2,'0')
            const s = String(elapsed%60).padStart(2,'0')
            finishTimesRef.current[user?._id] = `${m}:${s}`
            showFinishMessage(gateDataRef.current.totalGates, null)
            if (timerRef.current) clearInterval(timerRef.current)
            try {
              if (socket?.connected && roomIdRef.current) {
                socket.emit('raceFinished', {
                  roomId: roomIdRef.current,
                  winnerId: user?._id,
                  time: finishTimesRef.current[user?._id],
                })
              }
            } catch (_) { /* ignore */ }
          }
          updateGateFading(gateDataRef.current.fadingGates)
        }

        accumRef.current -= FIXED_PHYSICS_STEP
      }

      // Smooth remote car (reduces jitter / perceived clipping vs local car)
      const opp = oppModelRef.current
      if (opp && opp.visible) {
        opp.position.lerp(oppTargetPosRef.current, 0.22)
        const tgt = oppTargetQuatRef.current
        const t = oppSlerpTempRef.current.copy(tgt)
        if (opp.quaternion.dot(tgt) < 0) t.set(-tgt.x, -tgt.y, -tgt.z, -tgt.w)
        opp.quaternion.slerp(t, 0.22)
        opp.quaternion.normalize()
        opp.updateMatrixWorld(true)
      }

      drawMinimap()
      rendererRef.current?.render(sceneRef.current, cameraRef.current)
    } catch (e) {
      console.error('[RacingGame] render loop error', e)
      if (afRef.current) {
        cancelAnimationFrame(afRef.current)
        afRef.current = null
      }
      // Do not hard-exit on a single frame error; try recovering next tick.
      setTimeout(() => {
        if (!raceExitHandledRef.current) animate()
      }, 100)
    }
  }, [socket, user?._id])

  // ─── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    // Stop animation loop + timers
    if (afRef.current)    cancelAnimationFrame(afRef.current)
    if (timerRef.current) clearInterval(timerRef.current)

    // Remove resize listener
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = null

    // Dispose Three.js renderer
    const renderer = rendererRef.current
    if (renderer) { renderer.dispose(); renderer.domElement?.remove() }

    // Remove minimap canvas
    const mm = minimapRef.current?.canvas
    if (mm) mm.remove()

    // Remove injected DOM overlays from game modules
    document.getElementById('finish-ui')?.remove()
    document.getElementById('final-leaderboard')?.remove()

    // Clean up global window properties set by game modules to prevent leaks
    delete window.raceState
    delete window.gateData
    delete window.playerFinishTimes
    delete window.startCountdown
    delete window.updateLeaderboard
    delete window.loadingManager

    // Clean up sessionStorage game config
    sessionStorage.removeItem('gameConfig')

    // End any active voice call when leaving the race
    leaveCall?.()
    try {
      if (startSfxRef.current) {
        startSfxRef.current.pause()
        startSfxRef.current.currentTime = 0
      }
      if (raceMusicRef.current) {
        raceMusicRef.current.pause()
        raceMusicRef.current.currentTime = 0
      }
    } catch (_) { /* ignore */ }
  }, [leaveCall])

  // ─── Voice call ────────────────────────────────────────────────────────────
  const handleCallOpp = () => {
    if (callActive) {
      disconnectRaceVoice()
    } else {
      connectRaceVoice()
    }
  }
  const handleMute = () => {
    const roomObj = raceVoiceRoomRef.current
    if (!roomObj?.localParticipant) return
    setMuted((prev) => {
      const next = !prev
      roomObj.localParticipant.setMicrophoneEnabled(!next).catch(() => {})
      return next
    })
  }

  const isIncomingOppCall = false

  // ─── Navigate back / leave race ────────────────────────────────────────────
  const handleLeave = () => {
    if (window.confirm('Leave the race?')) {
      exitRaceAndGoHome()
    }
  }

  // ─── Central "go home" — used by HOME button and result screen ─────────────
  const handleGoHome = () => {
    exitRaceAndGoHome()
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      width: '100%',
      position: 'relative',
      overflow: 'hidden',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      touchAction: 'none',
      overscrollBehavior: 'none',
    }}>

      {/* In-page remote audio (no separate call page needed during race) */}
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        muted={false}
        style={{ position:'fixed', width:0, height:0, opacity:0, pointerEvents:'none' }}
      />

      {/* Three.js host: absolute inset fills the flex area so the canvas always matches the visible game area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
          }}
        />
      </div>

      {/* Loading screen */}
      {loading && (
        <div style={{
          position:'fixed', inset:0, background:'#0d0d14',
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          zIndex:9999, fontFamily:'Poppins,sans-serif',
        }}>
          {/* Keyframe animation injected via style tag */}
          <style>{`
            @keyframes racezBarAnim {
              0%,100% { transform: scaleY(0.2); opacity: 0.5; }
              50%      { transform: scaleY(1);   opacity: 1; }
            }
            @keyframes racezPulse { 0%,100%{opacity:.7} 50%{opacity:1} }
          `}</style>

          {/* Title */}
          <div style={{
            fontSize:'clamp(2.5rem,8vw,5rem)', fontWeight:900, color:'#fff',
            letterSpacing:'clamp(2px,1.2vw,6px)', marginBottom:'40px',
            textShadow:'0 6px 0 #000, 0 0 40px rgba(255,0,128,0.4)',
            WebkitTextStroke:'2px #000',
          }}>playsocial</div>

          {/* Animated bars */}
          <div style={{ display:'flex', gap:'8px', marginBottom:'20px' }}>
            {[0,0.12,0.24,0.36,0.48].map((d,i) => (
              <div key={i} style={{
                width:'12px', height:'52px', background:'#ff0080', borderRadius:'4px',
                animation:`racezBarAnim 1.3s ${d}s infinite ease-in-out`,
              }} />
            ))}
          </div>

          {/* Status text */}
          {loadingPhase === 'error' ? (
            <div style={{ color:'#ff4444', fontWeight:700, fontSize:'1rem', textAlign:'center', maxWidth:340 }}>
              Failed to load physics engine.<br/>
              <span style={{ fontSize:'0.85rem', opacity:.7 }}>
                Please check your connection and refresh.
              </span>
              <br/><br/>
              <button
                onClick={() => window.location.reload()}
                style={{
                  marginTop:8, padding:'10px 28px', background:'#e63946', color:'#fff',
                  border:'none', borderRadius:10, fontWeight:700, fontSize:'1rem', cursor:'pointer',
                }}
              >Retry</button>
            </div>
          ) : loadingPhase === 'engine' ? (
            <div style={{ color:'rgba(255,255,255,0.8)', fontWeight:600, fontSize:'1rem',
              animation:'racezPulse 2s infinite' }}>
              Initializing physics engine…
            </div>
          ) : (
            <div style={{ color:'rgba(255,255,255,0.8)', fontWeight:600, fontSize:'1rem' }}>
              {loadingPct > 0 ? `Loading game assets ${loadingPct}%…` : 'Loading game assets…'}
            </div>
          )}
        </div>
      )}

      {/* Waiting for opponent */}
      {!loading && waitingOpp && !raceStateRef.current.countdownStarted && (
        <div style={{
          position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          background:'rgba(0,0,0,0.75)', backdropFilter:'blur(12px)',
          color:'#fff', padding:'30px 50px', borderRadius:'12px', textAlign:'center',
          fontFamily:'Poppins,sans-serif', fontSize:'22px', zIndex:1000,
          boxShadow:'0 0 30px rgba(0,0,0,0.7)',
        }}>
          <div style={{ fontSize:'14px', opacity:.6, marginBottom:'8px' }}>Race</div>
          <div>Waiting for opponent...</div>
          <div style={{ marginTop:'16px', fontSize:'16px', opacity:.75 }}>
            {opponent ? `vs ${opponent.name || opponent.username}` : ''}
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {countdown !== null && (
        <div style={{
          position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
          background:'rgba(0,0,0,0.6)', color:'#fff',
          padding:'30px 60px', borderRadius:'12px', textAlign:'center',
          fontFamily:'Poppins,sans-serif', fontSize:'72px', fontWeight:900,
          zIndex:1000, textShadow:'0 0 20px rgba(255,255,255,0.6)',
          boxShadow:'0 0 30px rgba(0,0,0,0.7)',
        }}>
          {countdown}
        </div>
      )}

      {/* HUD — top left: player names + gate progress (below fixed app header) */}
      {!loading && (
        <div style={{
          position:'fixed', top:`${RACE_TOP_OFFSET_PX}px`, left:'20px', zIndex:1000,
          background:'rgba(0,0,0,0.55)', backdropFilter:'blur(8px)',
          borderRadius:'10px', padding:'12px 18px', color:'#fff',
          fontFamily:'Poppins,sans-serif', minWidth:'200px',
          boxShadow:'0 0 20px rgba(0,0,0,0.5)',
        }}>
          <div style={{ fontSize:'11px', opacity:.5, marginBottom:'6px', letterSpacing:'2px' }}>LEADERBOARD</div>
          <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'6px' }}>
            <div style={{ width:12, height:12, borderRadius:'50%', background: myColorRef.current==='blue' ? '#4dc9ff' : '#ff4444' }} />
            <span style={{ fontWeight:700, flex:1 }}>You</span>
            <span style={{ opacity:.7 }}>Gate {myGate}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <div style={{ width:12, height:12, borderRadius:'50%', background: oppColorRef.current==='blue' ? '#4dc9ff' : '#ff4444' }} />
            <span style={{ flex:1, opacity:.8 }}>{opponent?.name || opponent?.username || 'Opponent'}</span>
            <span style={{ opacity:.7 }}>Gate {oppGate}</span>
          </div>
        </div>
      )}

      {!loading && reconnecting && (
        <div style={{
          position:'fixed',
          top:`${RACE_TOP_OFFSET_PX + 84}px`,
          left:'20px',
          zIndex:1001,
          background:'rgba(0,0,0,0.62)',
          border:'1px solid rgba(255,255,255,0.2)',
          borderRadius:'10px',
          padding:'8px 12px',
          color:'#fde68a',
          fontFamily:'Poppins,sans-serif',
          fontSize:'12px',
        }}>
          Reconnecting...
        </div>
      )}

      {/* HUD — top center: timer */}
      {!loading && raceLive && (
        <div style={{
          position:'fixed', top:`${RACE_TOP_OFFSET_PX}px`, left:'50%', transform:'translateX(-50%)',
          background:'rgba(0,0,0,0.55)', backdropFilter:'blur(8px)',
          borderRadius:'10px', padding:'10px 24px', color:'#fff',
          fontFamily:'Poppins,sans-serif', fontSize:'28px', fontWeight:700,
          zIndex:1000, textShadow:'0 0 10px rgba(255,255,255,0.4)',
          boxShadow:'0 0 20px rgba(0,0,0,0.5)',
        }}>
          {raceTime}
        </div>
      )}

      {/* Speedometer — bottom right */}
      {!loading && (
        <div id="racing-ui" style={{
          position:'fixed', bottom:'30px', right:'30px', zIndex:1000,
          pointerEvents:'none', userSelect:'none',
        }}>
          <div style={{ width:'160px' }}>
            <div style={{
              position:'relative', borderRadius:'50%',
              background:'rgba(0,0,0,0.55)', padding:'16px',
              boxShadow:'0 0 20px rgba(0,0,0,0.5)', backdropFilter:'blur(8px)',
            }}>
              <div style={{
                position:'relative', width:'100%', paddingBottom:'50%',
                background:'#222', borderTopLeftRadius:'100px',
                borderTopRightRadius:'100px', overflow:'hidden',
              }}>
                <div className="race-gauge-fill" style={{
                  position:'absolute', top:'100%', left:0,
                  width:'100%', height:'100%', transformOrigin:'top center',
                  transform:'rotate(0deg)',
                  background:'linear-gradient(to right, #4dc9ff, #ff0080)',
                  transition:'transform 0.1s',
                }} />
                <div className="race-gauge-needle" style={{
                  position:'absolute', width:'4px', height:'50%',
                  background:'#ff0000', bottom:0, left:'50%', marginLeft:'-2px',
                  transformOrigin:'bottom center', transform:'rotate(-90deg)',
                  transition:'transform 0.1s', zIndex:10,
                }} />
              </div>
              <div className="race-speed-value" style={{
                fontFamily:'Poppins,sans-serif', fontSize:'36px', fontWeight:700,
                color:'#fff', marginTop:'8px', textAlign:'center',
                textShadow:'0 0 10px rgba(255,255,255,0.5)',
              }}>0</div>
              <div style={{
                fontFamily:'Poppins,sans-serif', fontSize:'12px',
                color:'#aaa', textAlign:'center',
              }}>KPH</div>
            </div>
          </div>
        </div>
      )}

      {/* Voice: LiveKit in-race opponent voice */}
      {!loading && (
        <div style={{
          position:'fixed', bottom:'20px', left:'20px', right:'220px', zIndex:1000,
          display:'flex', flexDirection:'column', gap:'10px', maxWidth:420,
        }}>
          <div style={{
            fontFamily:'Poppins,sans-serif', fontSize:'11px', color:'rgba(255,255,255,0.45)',
            letterSpacing:'0.04em', textTransform:'uppercase',
          }}>
            Voice with opponent — tap the phone, accept mic. Safari on Mac: allow when the browser asks.
          </div>
          {callActive && (
            <div style={{
              display:'flex', alignItems:'center', gap:'10px',
              background:'rgba(15,23,42,0.92)', border:'1px solid rgba(255,255,255,0.12)',
              borderRadius:'14px', padding:'10px 14px', color:'#e2e8f0', fontFamily:'Poppins,sans-serif',
              fontSize:'13px', boxShadow:'0 8px 24px rgba(0,0,0,0.45)',
            }}>
              <span style={{ fontSize:'18px' }}>🎧</span>
              <span style={{ flex:1, opacity:0.95 }}>
                {callActive ? 'Connected — opponent audio is live' : 'Connecting… accept mic if the browser asks'}
              </span>
            </div>
          )}
          <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
            <button onClick={handleCallOpp} title={callActive ? 'End race voice' : 'Start race voice'} style={{
              width:52, height:52, borderRadius:'50%', border:'none', cursor:'pointer',
              background: callActive ? '#ef4444' : '#22c55e',
              color:'#fff', fontSize:'22px', display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 4px 0 rgba(0,0,0,0.4)', fontFamily:'sans-serif',
            }}>
              📞
            </button>
            {voiceConnecting && (
              <div style={{ color:'rgba(255,255,255,0.75)', fontSize:'12px', fontFamily:'Poppins,sans-serif' }}>
                Connecting voice...
              </div>
            )}
            {callActive && (
              <button onClick={handleMute} title={muted ? 'Unmute mic' : 'Mute mic'} style={{
                width:52, height:52, borderRadius:'50%', border:'none', cursor:'pointer',
                background: muted ? '#6b7280' : '#3b82f6',
                color:'#fff', fontSize:'20px', display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 4px 0 rgba(0,0,0,0.4)',
              }}>
                {muted ? '🔇' : '🎙️'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Leave button (offset so it does not overlap call + mute) */}
      {!loading && (
        <button onClick={handleLeave} title="Leave race" style={{
          position:'fixed', bottom:'20px', left:'200px', zIndex:1000,
          width:44, height:44, borderRadius:'50%',
          background:'#ff0080', border:'2px solid #b30059',
          boxShadow:'0 3px 0 #b30059', color:'#fff', fontSize:'18px',
          cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
        }}>🚪</button>
      )}

      {/* Controls hint */}
      {!loading && raceLive && (
        <div style={{
          position:'fixed', bottom:'20px', right:'220px', zIndex:1000,
          color:'rgba(255,255,255,0.4)', fontFamily:'Poppins,sans-serif', fontSize:'12px',
          textAlign:'right', pointerEvents:'none',
        }}>
          W/↑ Accelerate &nbsp;·&nbsp; S/↓ Brake &nbsp;·&nbsp; A/D Steer &nbsp;·&nbsp; R Reset
        </div>
      )}

      {/* Game over overlay */}
      {raceFinished && winner && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:2000,
        }}>
          <div style={{
            background:'rgba(0,0,0,0.85)', backdropFilter:'blur(16px)',
            borderRadius:'16px', padding:'48px 64px', textAlign:'center',
            fontFamily:'Poppins,sans-serif', color:'#fff',
            boxShadow:'0 0 40px rgba(0,0,0,0.8)',
            animation:'slideIn 0.8s cubic-bezier(0.12,0.93,0.27,0.98)',
          }}>
            <div style={{ fontSize:'64px', marginBottom:'16px' }}>
              {winner === 'you' || winner === 'opponent_left' ? '🏆' : '🏁'}
            </div>
            <div style={{
              fontSize:'36px', fontWeight:900, marginBottom:'12px',
              color: (winner === 'you' || winner === 'opponent_left') ? '#ffd700' : '#fff',
              textShadow: (winner === 'you' || winner === 'opponent_left') ? '0 0 20px rgba(255,215,0,0.6)' : 'none',
            }}>
              {winner === 'you' ? 'YOU WIN!'
                : winner === 'opponent_left' ? 'OPPONENT LEFT'
                : winner === 'opponent' ? 'OPPONENT FINISHED FIRST'
                : 'RACE FINISHED'}
            </div>
            <div style={{ fontSize:'18px', opacity:.7, marginBottom:'32px' }}>
              {winner === 'you' ? `Time: ${raceTime}`
                : winner === 'opponent_left' ? 'Your opponent quit the race'
                : winner === 'opponent' ? 'They crossed the finish line before you. Great race!'
                : `Better luck next time`}
            </div>
            <button onClick={handleGoHome} style={{
              padding:'14px 40px', borderRadius:'8px', border:'2px solid #b30059',
              background:'#ff0080', color:'#fff', fontSize:'16px', fontWeight:700,
              cursor:'pointer', fontFamily:'Poppins,sans-serif',
              boxShadow:'0 4px 0 #b30059',
            }}>
              HOME
            </button>
          </div>
        </div>
      )}

      {/* CSS keyframes */}
      <style>{`
        @keyframes barLoad {
          0%,100% { transform: scaleY(0.1); }
          50% { transform: scaleY(1); }
        }
        @keyframes slideIn {
          from { opacity:0; transform: translateX(-60%) translateY(-50%) scale(0.8); }
          to   { opacity:1; transform: translateX(-50%) translateY(-50%) scale(1); }
        }
      `}</style>
    </div>
  )
}
