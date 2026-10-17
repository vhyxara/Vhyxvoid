'use client'

// The product's logo in the dashboard sidebar and on the sign-in pages: the
// built-in mark and name, or the logo set in the admin panel (Settings ›
// Brand). The name fades out when the sidebar is collapsed.
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

import Image from 'next/image'

import styled from '@emotion/styled'

import type { VerticalNavContextProps } from '@menu/contexts/verticalNavContext'
import useVerticalNav from '@menu/hooks/useVerticalNav'
import { useSettings } from '@core/hooks/useSettings'
import { usePublicBootstrap } from '@/api/application/hooks/usePublicSite'

type LogoTextProps = {
  isHovered?: VerticalNavContextProps['isHovered']
  isCollapsed?: VerticalNavContextProps['isCollapsed']
  transitionDuration?: VerticalNavContextProps['transitionDuration']
  isBreakpointReached?: VerticalNavContextProps['isBreakpointReached']
  color?: CSSProperties['color']
}

const LogoText = styled.span<LogoTextProps>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: ${({ transitionDuration }) =>
    `margin-inline-start ${transitionDuration}ms ease-in-out, opacity ${transitionDuration}ms ease-in-out`};

  ${({ isHovered, isCollapsed, isBreakpointReached }) =>
    !isBreakpointReached && isCollapsed && !isHovered
      ? 'opacity: 0; margin-inline-start: 0;'
      : 'opacity: 1; margin-inline-start: 10px;'}

  .logo-tagline {
    font-size: 0.5rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: #6b6b80;
    text-transform: uppercase;
    font-family: 'Inter', sans-serif;
    white-space: nowrap;
  }
`

const FONT = "'Inter', 'SF Pro Display', sans-serif"

const Logo = ({ color }: { color?: CSSProperties['color'] }) => {
  const logoTextRef = useRef<HTMLSpanElement>(null)
  const { isHovered, transitionDuration, isBreakpointReached } = useVerticalNav()
  const { layout } = useSettings().settings
  const brand = usePublicBootstrap().data?.settings
  const customLogo = typeof brand?.['brand.logoUrl'] === 'string' ? brand['brand.logoUrl'] : ''
  const productName = typeof brand?.['general.productName'] === 'string' && brand['general.productName'] ? brand['general.productName'] : 'VhyxVoid'
  const textProps = { ref: logoTextRef, color, isHovered, isCollapsed: layout === 'collapsed', transitionDuration, isBreakpointReached }

  // A collapsed sidebar shows the mark alone until it is hovered.
  useEffect(() => {
    if (layout !== 'collapsed' || !logoTextRef.current) return
    logoTextRef.current.classList.toggle('hidden', !isBreakpointReached && !isHovered)
  }, [isHovered, layout, isBreakpointReached])

  if (customLogo) {
    return (
      <div className='flex items-center'>
        {/* eslint-disable-next-line @next/next/no-img-element -- an admin-chosen address, not a build-time asset */}
        <img src={customLogo} alt={brand?.['brand.logoOnly'] ? productName : ''} style={{ blockSize: 40, inlineSize: 'auto', maxInlineSize: 180, objectFit: 'contain' }} />
        {!brand?.['brand.logoOnly'] && (
          <LogoText {...textProps}>
            <span className='text-xl font-black tracking-wide' style={{ color: color ?? 'var(--vhyx-color-text)' }}>
              {productName}
            </span>
          </LogoText>
        )}
      </div>
    )
  }

  return (
    <div className='flex items-center'>
      <Image src='/images/logos/roundvhyxvoid.png' alt='' width={50} height={50} />
      <LogoText {...textProps}>
        <span className='flex text-xl items-baseline tracking-wide' aria-label={productName}>
          <span className='font-black' style={{ fontFamily: FONT, color: color ?? '#fff' }}>
            Vhyx
          </span>
          <span className='font-black' style={{ fontFamily: FONT, color: 'var(--brand-accent, #7C3AED)' }}>
            Void
          </span>
        </span>
        <span className='logo-tagline'>Tunnel beyond localhost</span>
      </LogoText>
    </div>
  )
}

export default Logo
