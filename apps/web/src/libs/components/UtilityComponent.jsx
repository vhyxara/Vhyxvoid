import { getInitials } from '@/utils/getInitials'
import { Avatar } from '@mui/material'

export const getAvatar = ({ src = '', name = '', className = '' }) => {
  if (src !== '') return <Avatar src={src} className={` ${className}`} />

  return <Avatar className={` ${className}`}>{getInitials(name)}</Avatar>
}
