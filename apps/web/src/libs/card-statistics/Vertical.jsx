// MUI Imports
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import CardContent from '@mui/material/CardContent'

// Third-party Imports
import classnames from 'classnames'

// Component Import
import CustomAvatar from '@core/components/mui/Avatar'
import { getAvatar } from '@/utils/utility'
const CardStatsVertical = props => {
  // Props
  const {
    stats,
    title,
    subtitle,
    avatarIcon,
    avatarColor,
    avatarSize,
    avatarIconSize,
    avatarSkin,
    chipText,
    chipColor,
    chipVariant,
    typographyVariant,
    isIcon = 'icon'
  } = props
  console.log('avatarIcons', avatarIcon)
  console.log('isIcon', isIcon)

  const renderIcon = () => {
    if (isIcon === 'none') return null
    if (isIcon === 'avatar') {
      return Array.isArray(avatarIcon) ? getAvatar(...avatarIcon) : getAvatar(avatarIcon)
    }
    return (
      <CustomAvatar variant='rounded' skin={avatarSkin} size={avatarSize} color={avatarColor}>
        <i className={classnames(avatarIcon, 'text-[20px]')} style={{ fontSize: avatarIconSize }} />
      </CustomAvatar>
    )
  }
  return (
    <Card>
      <CardContent className='flex flex-col gap-y-2 items-start'>
        {renderIcon()}
        <Typography variant={typographyVariant || 'h5'} className='capitalize'>
          {title}
        </Typography>
        <div className='flex flex-col gap-2 justify-between w-full'>
          <Typography color='text.disabled'>{subtitle}</Typography>
          <Chip label={stats} color={'info'} variant={chipVariant} size='small' />
        </div>

        {/* {isIcon === 'avatar' && Array.isArray(avatarIcon) ? getAvatar(...avatarIcon) : getAvatar(avatarIcon)} */}
        {/* <div className='flex flex-col gap-y-1'>
          <Typography color='text.primary'>{stats}</Typography>
        </div> */}
        {/* <Chip label={chipText} color={chipColor} variant={chipVariant} size='small' /> */}
        <Typography variant='body2' color='success.main'>
          {chipText}
        </Typography>
      </CardContent>
    </Card>
  )
}

export default CardStatsVertical
