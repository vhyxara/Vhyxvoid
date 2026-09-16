'use client'

// React Imports
import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'

// Third-party Imports
import Image from 'next/image'

import styled from '@emotion/styled'

// Type Imports
import type { VerticalNavContextProps } from '@menu/contexts/verticalNavContext'

// Component Imports
// import VuexyLogo from '@core/svg/Logo'

// Config Imports
// import themeConfig from '@configs/themeConfig'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'
import { useSettings } from '@core/hooks/useSettings'

type LogoTextProps = {
  isHovered?: VerticalNavContextProps['isHovered']
  isCollapsed?: VerticalNavContextProps['isCollapsed']
  transitionDuration?: VerticalNavContextProps['transitionDuration']
  isBreakpointReached?: VerticalNavContextProps['isBreakpointReached']
  color?: CSSProperties['color']
}

// const LogoText = styled.span<LogoTextProps>`
//   font-size: 1.375rem;
//   line-height: 1.09091;
//   font-weight: 700;
//   letter-spacing: 0.25px;
//   transition: ${({ transitionDuration }) =>
//     `margin-inline-start ${transitionDuration}ms ease-in-out, opacity ${transitionDuration}ms ease-in-out`};

//   ${({ isHovered, isCollapsed, isBreakpointReached }) =>
//     !isBreakpointReached && isCollapsed && !isHovered
//       ? 'opacity: 0; margin-inline-start: 0;'
//       : 'opacity: 1; margin-inline-start: 12px;'}

//   .logo-vhyx {
//     color: ${({ color }) => color ?? 'var(--mui-palette-text-primary)'};
//   }

//   .logo-void {
//     color: #7c3aed;
//   }
// `
// .logo-brand {
//   display: flex;
//   align-items: baseline;
//   line-height: 1;
//   letter-spacing: 2px;
// }

// .logo-vhyx {
//   font-size: 1.5rem;
//   font-weight: 900;
//   color: ${({ color }) => color ?? '#FFFFFF'};
//   font-family: 'Inter', 'SF Pro Display', sans-serif;
// }

// .logo-void {
//   font-size: 1.5rem;
//   font-weight: 900;
//   color: #7c3aed;
//   font-family: 'Inter', 'SF Pro Display', sans-serif;
// }
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

const Logo = ({ color }: { color?: CSSProperties['color'] }) => {
  // Refs
  const logoTextRef = useRef<HTMLSpanElement>(null)

  // Hooks
  const { isHovered, transitionDuration, isBreakpointReached } = useVerticalNav()
  const { settings } = useSettings()

  // Vars
  const { layout } = settings

  useEffect(() => {
    if (layout !== 'collapsed') {
      return
    }

    if (logoTextRef && logoTextRef.current) {
      if (!isBreakpointReached && layout === 'collapsed' && !isHovered) {
        logoTextRef.current?.classList.add('hidden')
      } else {
        logoTextRef.current.classList.remove('hidden')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHovered, layout, isBreakpointReached])

  return (
    <div className='flex items-center'>
      {/* <VuexyLogo className='text-2xl text-primary' /> */}
      <Image src='/images/logos/roundvhyxvoid.png' alt='Logo' width={50} height={50} />
      {/* <LogoText
        color={color}
        ref={logoTextRef}
        isHovered={isHovered}
        isCollapsed={layout === 'collapsed'}
        transitionDuration={transitionDuration}
        isBreakpointReached={isBreakpointReached}
      >
        {themeConfig.templateName}
      </LogoText> */}
      <LogoText
        ref={logoTextRef}
        color={color}
        isHovered={isHovered}
        isCollapsed={layout === 'collapsed'}
        transitionDuration={transitionDuration}
        isBreakpointReached={isBreakpointReached}
      >
        <span className='flex text-xl items-baseline tracking-wide'>
          <span className=' font-black text-white' style={{ fontFamily: "'Inter', 'SF Pro Display', sans-serif" }}>
            Vhyx
          </span>
          <span className=' font-black text-[#7C3AED]' style={{ fontFamily: "'Inter', 'SF Pro Display', sans-serif" }}>
            Void
          </span>
        </span>
        <span className='logo-tagline'>Tunnel beyond localhost</span>
      </LogoText>
    </div>
  )
}

export default Logo
