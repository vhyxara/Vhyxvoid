'use client'

// Next Imports
import Link from 'next/link'

// VhyxUI Imports
import { Button } from '@vhyxui/react'

// Type Imports
import type { SystemMode } from '@core/types'
import { Typography } from '@/components/vhyxui-shims'

// Hook Imports
import { useImageVariant } from '@core/hooks/useImageVariant'
import { AuthMaskImage } from '@/views/auth/AuthMaskImage'

const NotFound = ({ mode }: { mode: SystemMode }) => {
  // Vars
  const darkImg = '/images/pages/misc-mask-dark.png'
  const lightImg = '/images/pages/misc-mask-light.png'

  // Hooks
  const miscBackground = useImageVariant(mode, lightImg, darkImg)

  return (
    <div className='flex items-center justify-center min-bs-dvh relative p-6 overflow-x-hidden'>
      <div className='flex items-center flex-col text-center'>
        <div className='flex flex-col gap-2 is-[90vw] sm:is-[unset] mbe-6'>
          <Typography className='font-medium text-8xl'>404</Typography>
          <Typography variant='h4'>Page Not Found ⚠️</Typography>
          <Typography>we couldn&#39;t find the page you are looking for.</Typography>
        </div>
        <Button asChild>
          <Link href='/'>Back To Home</Link>
        </Button>
        <img
          alt='error-404-illustration'
          src='/images/illustrations/characters/1.png'
          className='object-cover bs-[400px] md:bs-[450px] lg:bs-[500px] mbs-10 md:mbs-14 lg:mbs-20'
        />
      </div>
      <AuthMaskImage src={miscBackground} />
    </div>
  )
}

export default NotFound
