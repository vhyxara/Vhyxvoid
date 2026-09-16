'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import classnames from 'classnames'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

const FooterContent = () => {
  // Hooks
  const { isBreakpointReached } = useVerticalNav()

  return (
    <div
      className={classnames(verticalLayoutClasses.footerContent, 'flex items-center justify-between flex-wrap gap-4')}
    >
      <p className='flex items-center gap-1'>
        <span className='text-sm'>© {new Date().getFullYear()}</span>

        {/* VhyxVoid two-tone brand name */}
        <span className='flex items-baseline tracking-wide'>
          <span
            className='text-base font-black text-white'
            style={{ fontFamily: "'Inter', 'SF Pro Display', sans-serif" }}
          >
            Vhyx
          </span>
          <span
            className='text-base font-black text-[#7C3AED]'
            style={{ fontFamily: "'Inter', 'SF Pro Display', sans-serif" }}
          >
            Void
          </span>
        </span>

        <span className='text-sm'>. Secure tunnels for your local world.</span>
      </p>

      {!isBreakpointReached && (
        <div className='flex items-center gap-4'>
          <Link href='/docs' target='_blank' className='text-primary'>
            Documentation
          </Link>
          <Link href='/support' target='_blank' className='text-primary'>
            Support
          </Link>
        </div>
      )}
    </div>
  )
}

export default FooterContent
