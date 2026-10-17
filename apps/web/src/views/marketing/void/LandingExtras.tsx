'use client'

// Landing sections an admin fills in when they have something to show:
// customer logos under the hero, a product video and screenshots, and quotes
// from customers. Each is hidden while empty, so nothing made up is shown.
import type { CSSProperties } from 'react'
import { useState } from 'react'

import type { LandingContent } from '@vhyxvoid/content'

import styles from './void.module.css'

/**
 * How to play a video address: YouTube and Vimeo as their privacy-friendly
 * players, a video file (.mp4, .webm, .mov) as <video>; anything else isn't played.
 */
export function videoEmbed(url: string): { kind: 'iframe'; src: string } | { kind: 'file'; src: string } | null {
  let u: URL

  try {
    u = new URL(url)
  } catch {
    return null
  }

  if (u.protocol !== 'https:') return null
  const host = u.hostname.replace(/^(www|m)\./, '')
  const yt =
    host === 'youtu.be' ? u.pathname.slice(1) : host === 'youtube.com' || host === 'youtube-nocookie.com' ? (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1]) : null

  if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt}?rel=0` }
  const vimeo = host === 'vimeo.com' || host === 'player.vimeo.com' ? u.pathname.match(/(\d{6,12})/)?.[1] : null

  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo}?dnt=1` }
  if (/\.(mp4|webm|mov)$/i.test(u.pathname)) return { kind: 'file', src: url }

  return null
}

export function LogoStrip({ logos }: { logos: NonNullable<LandingContent['logos']> }) {
  return (
    <div className={`${styles.inner} ${styles.logos}`} data-reveal>
      {logos.title && <p className={styles.logosTitle}>{logos.title}</p>}
      <ul className={styles.logoRow}>
        {logos.items.map(l => {
          // Logos are shown as one quiet colour; the name is the image's text.
          const img = <img src={l.imageUrl} alt={l.name} loading='lazy' decoding='async' />

          return (
            <li key={l.name + l.imageUrl}>
              {l.href ? (
                <a href={l.href} target='_blank' rel='noopener noreferrer'>
                  {img}
                </a>
              ) : (
                img
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function Showcase({ showcase }: { showcase: NonNullable<LandingContent['showcase']> }) {
  const video = showcase.videoUrl ? videoEmbed(showcase.videoUrl) : null
  const [shot, setShot] = useState(0)
  const images = showcase.images

  if (!video && !images.length) return null

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        {(showcase.title || showcase.subtitle) && (
          <div className={styles.sectionHead} data-reveal>
            <span className={styles.kicker}>Showcase</span>
            {showcase.title && <h2 className={styles.h2}>{showcase.title}</h2>}
            {showcase.subtitle && <p className={styles.lead}>{showcase.subtitle}</p>}
          </div>
        )}
        {video && (
          <div className={styles.screen} data-reveal>
            {video.kind === 'iframe' ? (
              <iframe
                src={video.src}
                title={showcase.title || 'Product video'}
                loading='lazy'
                allow='accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen'
                referrerPolicy='strict-origin-when-cross-origin'
                allowFullScreen
              />
            ) : (
              <video src={video.src} controls preload='metadata' playsInline />
            )}
          </div>
        )}
        {images.length > 0 && (
          <div className={styles.shots} data-reveal>
            <figure className={styles.screen}>
              <img src={images[shot]?.imageUrl} alt={images[shot]?.alt || images[shot]?.caption || ''} loading='lazy' decoding='async' />
              {images[shot]?.caption && <figcaption>{images[shot].caption}</figcaption>}
            </figure>
            {images.length > 1 && (
              <div className={styles.shotTabs} role='tablist' aria-label='Screenshots'>
                {images.map((im, i) => (
                  <button key={im.imageUrl + i} type='button' role='tab' aria-selected={i === shot} aria-label={im.caption || im.alt || `Screenshot ${i + 1}`} onClick={() => setShot(i)}>
                    <img src={im.imageUrl} alt='' loading='lazy' decoding='async' />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('')

export function Testimonials({ testimonials }: { testimonials: NonNullable<LandingContent['testimonials']> }) {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.sectionHead} data-reveal>
          <span className={styles.kicker}>Testimonials</span>
          {testimonials.title && <h2 className={styles.h2}>{testimonials.title}</h2>}
        </div>
        <div className={styles.quotes}>
          {testimonials.items.map((t, i) => (
            <figure key={t.name + i} className={`${styles.card} ${styles.quote}`} data-reveal style={{ '--i': i } as CSSProperties}>
              <blockquote>
                <p>{t.quote}</p>
              </blockquote>
              <figcaption>
                {t.avatarUrl ? <img src={t.avatarUrl} alt='' loading='lazy' decoding='async' /> : <span aria-hidden>{initials(t.name)}</span>}
                <span>
                  <strong>{t.name}</strong>
                  {t.role && <small>{t.role}</small>}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
