'use client'

import { useEffect, useRef, useState } from 'react'

/** True when the visitor asked for less motion (OS setting). */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => setReduced(mq.matches)

    read()
    mq.addEventListener('change', read)

    return () => mq.removeEventListener('change', read)
  }, [])

  return reduced
}

/**
 * Marks elements with [data-reveal] inside the returned ref as visible
 * (data-visible) the first time they scroll into view, for CSS entrance
 * animations. Without IntersectionObserver everything is visible at once.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const root = ref.current

    if (!root) return
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))

    if (!('IntersectionObserver' in window)) {
      items.forEach(el => (el.dataset.visible = 'true'))

      return
    }

    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          ;(e.target as HTMLElement).dataset.visible = 'true'
          io.unobserve(e.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 }
    )

    items.forEach(el => io.observe(el))

    return () => io.disconnect()
  }, [])

  return ref
}

/** Whether an element is on screen, so animations can pause when it isn't. */
export function useInView<T extends HTMLElement>(margin = '0px') {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current

    if (!el || !('IntersectionObserver' in window)) return setInView(true)
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: margin })

    io.observe(el)

    return () => io.disconnect()
  }, [margin])

  return [ref, inView] as const
}

/**
 * Splits a stat like "< 50 ms" or "10 MB" into the number and the text
 * around it, so the number can count up. null when there is no number.
 */
export function splitStat(value: string): { before: string; number: number; decimals: number; after: string } | null {
  const m = value.match(/^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/)

  if (!m) return null
  const raw = m[2].replace(',', '.')

  return { before: m[1], number: Number(raw), decimals: raw.includes('.') ? raw.split('.')[1].length : 0, after: m[3] }
}

/**
 * A stat that counts up from 0 once `run` is true. The real value stays in
 * the page (visually hidden) for search engines and screen readers; the
 * counting copy is decorative. With reduced motion it shows the value as is.
 */
export function CountUp({ value, run, reduced }: { value: string; run: boolean; reduced: boolean }) {
  const parts = splitStat(value)
  const [n, setN] = useState(0)
  const done = useRef(false)
  const raf = useRef(0)

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current)
      done.current = false
    },
    []
  )

  // Counts once, to the end: scrolling away and back neither stops nor restarts it.
  useEffect(() => {
    if (!parts || !run || reduced || done.current) return
    done.current = true
    const start = performance.now()
    const dur = 1600
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)

      setN(parts.number * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, reduced, value])

  if (!parts || reduced) return <>{value}</>

  return (
    <>
      <span className='vv-sr-only'>{value}</span>
      <span aria-hidden>
        {parts.before}
        {n.toFixed(parts.decimals)}
        {parts.after}
      </span>
    </>
  )
}
