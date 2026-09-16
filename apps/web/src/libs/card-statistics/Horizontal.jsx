// MUI Imports
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'

// Third-party Imports
import classnames from 'classnames'

// Components Imports
import CustomAvatar from '@core/components/mui/Avatar'
import { Chip } from '@mui/material'

const CardStatHorizontal = props => {
  // Props
  const {
    stats,
    avatarIcon,
    avatarColor,
    chipColor,
    chipVariant,
    title,
    label,
    avatarSkin,
    avatarSize,
    avatarIconSize
  } = props

  return (
    <Card className='bs-full'>
      <CardContent>
        <Typography variant='h5' className='capitalize'>
          {stats}
        </Typography>
        <div className='flex flex-row justify-between items-center gap-x-4 gap-y-0.5'>
          <Typography variant='subtitle1' color='text.secondary'>
            {title}
          </Typography>
          <Chip label={label} color={chipColor} variant={chipVariant} />
        </div>
        {/* <CustomAvatar variant='rounded' color={avatarColor} skin={avatarSkin} size={avatarSize}>
            <i className={classnames(avatarIcon, `text-[${avatarIconSize}px]`)} />
          </CustomAvatar> */}
      </CardContent>
    </Card>
  )
}

export default CardStatHorizontal
