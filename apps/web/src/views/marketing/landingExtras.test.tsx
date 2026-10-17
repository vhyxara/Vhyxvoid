import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LogoStrip, Testimonials, videoEmbed } from './void/LandingExtras'

describe('landing extras', () => {
  it('plays YouTube and Vimeo in their privacy players, files as video, nothing else', () => {
    expect(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toEqual({ kind: 'iframe', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0' })
    expect(videoEmbed('https://youtu.be/dQw4w9WgXcQ')?.src).toContain('/embed/dQw4w9WgXcQ')
    expect(videoEmbed('https://youtube.com/shorts/dQw4w9WgXcQ')?.src).toContain('/embed/dQw4w9WgXcQ')
    expect(videoEmbed('https://vimeo.com/76979871')).toEqual({ kind: 'iframe', src: 'https://player.vimeo.com/video/76979871?dnt=1' })
    expect(videoEmbed('https://cdn.example.com/demo.mp4')).toEqual({ kind: 'file', src: 'https://cdn.example.com/demo.mp4' })
    expect(videoEmbed('http://youtu.be/dQw4w9WgXcQ')).toBeNull()
    expect(videoEmbed('https://evil.test/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(videoEmbed('javascript:alert(1)')).toBeNull()
  })

  it('names logos by their alt text and shows initials without a photo', () => {
    render(<LogoStrip logos={{ title: 'Trusted by', items: [{ name: 'Acme', imageUrl: '/media/a/acme.png', href: '' }] }} />)
    expect(screen.getByRole('img', { name: 'Acme' })).toBeTruthy()
    render(<Testimonials testimonials={{ title: 'Kind words', items: [{ quote: 'Saved us hours.', name: 'Ada Lovelace', role: 'CTO', avatarUrl: '' }] }} />)
    expect(screen.getByText('Saved us hours.')).toBeTruthy()
    expect(screen.getByText('AL')).toBeTruthy()
  })
})
