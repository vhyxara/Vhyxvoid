// // MUI Imports
// import { styled } from '@mui/material/styles'
// import CircularProgress from '@mui/material/CircularProgress'
// import { Typography } from '@mui/material'

// const CircularProgressDeterminate = styled(CircularProgress)({
//   color: 'var(--mui-palette-customColors-trackBg)'
// })

// const CircularProgressIndeterminate = styled(CircularProgress)(({ theme, speed, color1 }) => ({
//   left: 0,
//   position: 'absolute',
//   animationDuration: `${speed}ms`,
//   color: color1 || theme.palette.primary.main
//   // color: theme.palette.mode === 'light' ? '#1a90ff' : '#308fe8'
// }))

// const LOADER_COVER_TYPES = {
//   PAGE: 'page',
//   NORMAL: 'normal'
// }

// const Loader = ({
//   size = 50,
//   isVisible = true,
//   thickness = 3,
//   cover = LOADER_COVER_TYPES.PAGE,
//   progressValue = 100,
//   speed = 550,
//   text = '',
//   color = 'primary',
//   className,
//   textColor = ''
// }) => {
//   if (!isVisible) return null
//   return (
//     <div className={`relative ${className}`} style={{ visibility: isVisible ? 'visible' : 'hidden' }}>
//       {cover === LOADER_COVER_TYPES.PAGE && (
//         <div className='relative h-full w-full flex items-center justify-center cursor-not-allowed'>
//           <CircularProgressDeterminate
//             variant='determinate'
//             size={size}
//             thickness={thickness}
//             value={progressValue}
//             color1={color}
//           />
//           <CircularProgressIndeterminate
//             variant='indeterminate'
//             disableShrink
//             size={size}
//             thickness={thickness}
//             speed={speed}
//             color1={color}
//           />
//         </div>
//       )}
//       {cover === LOADER_COVER_TYPES.NORMAL && (
//         <div className='relative flex items-center justify-center gap-2'>
//           <CircularProgressDeterminate
//             variant='determinate'
//             size={size}
//             thickness={thickness}
//             value={progressValue}
//             color1={color}
//           />
//           <CircularProgressIndeterminate
//             variant='indeterminate'
//             disableShrink
//             size={size}
//             thickness={thickness}
//             speed={speed}
//             color1={color}
//           />
//           {!!text.length && (
//             <Typography variant='body1' color={textColor}>
//               {text}
//             </Typography>
//           )}
//         </div>
//       )}
//     </div>
//   )
// }

// export default Loader

// MUI Imports
import { styled } from '@mui/material/styles'
import type { CircularProgressProps } from '@mui/material/CircularProgress'
import CircularProgress from '@mui/material/CircularProgress'
import { Typography } from '@mui/material'

// Styled components
const CircularProgressDeterminate = styled(CircularProgress)({
  color: 'var(--mui-palette-customColors-trackBg)'
})

// theme: any
interface CircularProgressIndeterminateProps {
  speed: number
  color1?: string
}

const CircularProgressIndeterminate = styled(CircularProgress)<CircularProgressIndeterminateProps>(
  ({ theme, speed, color1 }) => ({
    left: 0,
    position: 'absolute',
    animationDuration: `${speed}ms`,
    color: color1 ?? theme.palette.primary.main
  })
)

// Loader Cover Types Enum
const LOADER_COVER_TYPES = {
  PAGE: 'page',
  NORMAL: 'normal'
} as const

type LoaderCoverType = (typeof LOADER_COVER_TYPES)[keyof typeof LOADER_COVER_TYPES]

interface LoaderProps {
  size?: number
  isVisible?: boolean
  thickness?: number
  cover?: LoaderCoverType
  progressValue?: number
  speed?: number
  text?: string
  color?: CircularProgressProps['color']
  className?: string
  textColor?: string
  spinnerColor?: string
}

const Loader: React.FC<LoaderProps> = ({
  size = 50,
  isVisible = true,
  thickness = 3,
  cover = LOADER_COVER_TYPES.PAGE,
  progressValue = 100,
  speed = 550,
  text = '',
  color = 'primary',
  className,
  textColor = ''
}) => {
  if (!isVisible) return null

  return (
    <div className={`relative ${className}`} style={{ visibility: isVisible ? 'visible' : 'hidden' }}>
      {cover === LOADER_COVER_TYPES.PAGE && (
        <div className='relative h-full w-full flex items-center justify-center cursor-not-allowed'>
          <CircularProgressDeterminate
            variant='determinate'
            size={size}
            thickness={thickness}
            value={progressValue}
            color={color}
          />
          <CircularProgressIndeterminate
            variant='indeterminate'
            disableShrink
            size={size}
            thickness={thickness}
            speed={speed}
            color1={color}
          />
        </div>
      )}
      {cover === LOADER_COVER_TYPES.NORMAL && (
        <div className='relative flex items-center justify-center gap-2'>
          <CircularProgressDeterminate
            variant='determinate'
            size={size}
            thickness={thickness}
            value={progressValue}
            color={color}
          />
          <CircularProgressIndeterminate
            variant='indeterminate'
            disableShrink
            size={size}
            thickness={thickness}
            speed={speed}
            color1={color}
          />
          {!!text.length && (
            <Typography variant='body1' color={textColor}>
              {text}
            </Typography>
          )}
        </div>
      )}
    </div>
  )
}

export default Loader
