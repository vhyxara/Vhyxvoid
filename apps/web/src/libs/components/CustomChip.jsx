import { Tooltip, Typography } from '@mui/material'
import React from 'react'

const CustomChip = ({
  text = 'text',
  color,
  tooltipTitle,
  showTooltip = true,
  size = 'medium', // Default size is 'medium'
  className = '', // Default to an empty className
  handleFunction = () => console.log('No function provided')
}) => {
  // Define size-based styles
  const sizeStyles = {
    small: 'px-2 py-1 text-xs', // Smaller padding and font size
    medium: 'px-4 py-2 text-sm', // Default size
    large: 'px-6 py-3 text-base' // Larger padding and font size
  }

  // Choose the appropriate size class based on the size prop
  const sizeClass = sizeStyles[size] || sizeStyles.medium
  // Rendering the component
  const content = (
    <div
      className={`relative w-max  rounded-md overflow-clip bg-transparent cursor-pointer  ${sizeClass} ${className}`}
      onClick={() => handleFunction()}
    >
      <div
        className='absolute w-full h-full top-0 left-0 opacity-10'
        style={{ backgroundColor: color }} // Color background
      />
      <Typography className='text-sm' style={{ color: color }}>
        {text}
      </Typography>
    </div>
  )

  // Render with or without Tooltip based on `showTooltip`
  return showTooltip ? (
    <Tooltip arrow title={tooltipTitle || text}>
      {content}
    </Tooltip>
  ) : (
    content
  )
}

export default CustomChip
