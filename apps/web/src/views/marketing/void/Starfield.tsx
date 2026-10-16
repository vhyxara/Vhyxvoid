'use client'

// The void: a deep-space canvas behind the hero. Stars drift towards the
// viewer; now and then an API packet streaks in from the edge and falls into
// the void's core at (focusX, focusY). Pauses when off screen or the tab is
// hidden; one still frame with reduced motion. Decorative only.
import type { RefObject } from 'react'
import { useEffect, useRef } from 'react'

type Star = { x: number; y: number; z: number; tw: number }
type Packet = { sx: number; sy: number; cx: number; cy: number; t: number; speed: number; hue: string }

const HUES = ['167, 139, 250', '34, 211, 238', '232, 121, 249', '96, 165, 250']

/** focusRef: the element the packets fall into (its centre); otherwise focusX/focusY as fractions of the canvas. */
export function Starfield({ focusX: fx0 = 0.72, focusY: fy0 = 0.45, focusRef, density = 1, className }: { focusX?: number; focusY?: number; focusRef?: RefObject<HTMLElement | null>; density?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')

    if (!canvas || !ctx) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let w = 0
    let h = 0
    let focusX = fx0
    let focusY = fy0
    let stars: Star[] = []
    const packets: Packet[] = []
    let raf = 0
    let running = false
    let visible = true
    let last = performance.now()
    let nextPacket = 600
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 }

    const spawn = (z = Math.random()): Star => ({ x: (Math.random() * 2 - 1) * 1.4, y: (Math.random() * 2 - 1) * 1.4, z: 0.15 + z * 0.85, tw: Math.random() * Math.PI * 2 })

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()

      w = rect.width
      h = rect.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const target = focusRef?.current?.getBoundingClientRect()

      if (target && target.width && w && h) {
        focusX = (target.left + target.width / 2 - rect.left) / w
        focusY = (target.top + target.height / 2 - rect.top) / h
      }
      const count = Math.min(520, Math.round(((w * h) / 3200) * density))

      stars = Array.from({ length: count }, () => spawn())
    }

    const launch = () => {
      // From a random point on the edge, curving into the core.
      const side = Math.floor(Math.random() * 4)
      const r = Math.random()
      const sx = side === 0 ? r * w : side === 1 ? w + 20 : side === 2 ? r * w : -20
      const sy = side === 0 ? -20 : side === 1 ? r * h : side === 2 ? h + 20 : r * h
      const fx = focusX * w
      const fy = focusY * h
      // Control point off the straight line, for a swirl into the void.
      const mx = (sx + fx) / 2 + (fy - sy) * 0.35
      const my = (sy + fy) / 2 - (fx - sx) * 0.35

      packets.push({ sx, sy, cx: mx, cy: my, t: 0, speed: 0.00035 + Math.random() * 0.00035, hue: HUES[Math.floor(Math.random() * HUES.length)] })
    }

    const at = (p: Packet, t: number) => {
      const fx = focusX * w
      const fy = focusY * h
      const u = 1 - t

      return { x: u * u * p.sx + 2 * u * t * p.cx + t * t * fx, y: u * u * p.sy + 2 * u * t * p.cy + t * t * fy }
    }

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, w, h)
      pointer.x += (pointer.tx - pointer.x) * 0.04
      pointer.y += (pointer.ty - pointer.y) * 0.04
      const cx = w * focusX + pointer.x * 30
      const cy = h * focusY + pointer.y * 30
      const scale = Math.max(w, h) * 0.5

      for (const s of stars) {
        if (!reduced) {
          s.z -= dt * 0.000045
          s.tw += dt * 0.003
        }

        if (s.z <= 0.12) Object.assign(s, spawn(1))
        const x = cx + (s.x / s.z) * scale * 0.5
        const y = cy + (s.y / s.z) * scale * 0.5

        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) {
          Object.assign(s, spawn(1))
          continue
        }

        const depth = 1 - s.z
        const size = 0.35 + depth * 1.6
        const alpha = Math.min(1, 0.25 + depth * 0.9) * (0.75 + Math.sin(s.tw) * 0.25)

        ctx.fillStyle = `rgba(226, 232, 255, ${alpha})`
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }

      if (reduced) return
      nextPacket -= dt

      if (nextPacket <= 0 && packets.length < 7) {
        launch()
        nextPacket = 700 + Math.random() * 1600
      }

      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i]

        p.t += dt * p.speed

        if (p.t >= 1) {
          packets.splice(i, 1)
          continue
        }

        const head = at(p, p.t)
        const tail = at(p, Math.max(0, p.t - 0.12))
        const fade = p.t > 0.85 ? (1 - p.t) / 0.15 : 1
        const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)

        g.addColorStop(0, `rgba(${p.hue}, 0)`)
        g.addColorStop(1, `rgba(${p.hue}, ${0.9 * fade})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()

        for (let k = 0; k <= 10; k++) {
          const q = at(p, Math.max(0, p.t - 0.12 + (0.12 * k) / 10))

          k === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)
        }

        ctx.stroke()
        ctx.fillStyle = `rgba(255, 255, 255, ${fade})`
        ctx.shadowColor = `rgba(${p.hue}, 1)`
        ctx.shadowBlur = 12
        ctx.beginPath()
        ctx.arc(head.x, head.y, 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
      }
    }

    const loop = (t: number) => {
      const dt = Math.min(64, t - last)

      last = t
      draw(dt)
      raf = requestAnimationFrame(loop)
    }

    const start = () => {
      if (running || reduced || !visible || document.hidden) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }

    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    const onMove = (e: PointerEvent) => {
      pointer.tx = e.clientX / window.innerWidth - 0.5
      pointer.ty = e.clientY / window.innerHeight - 0.5
    }

    const onVisibility = () => (document.hidden ? stop() : start())
    const ro = new ResizeObserver(() => {
      resize()
      if (!running) draw(0)
    })
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      visible ? start() : stop()
    })

    resize()
    draw(0)
    ro.observe(canvas)
    io.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pointermove', onMove, { passive: true })
    start()

    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onMove)
    }
  }, [fx0, fy0, focusRef, density])

  return <canvas ref={ref} className={className} aria-hidden />
}
