'use client'

// MUI Imports
import Grid from '@mui/material/Grid'
import Radio from '@mui/material/Radio'
import Typography from '@mui/material/Typography'
import { styled } from '@mui/material/styles'

// Third-party Imports
import classnames from 'classnames'
import Image from 'next/image'

const Root = styled('div', {
  name: 'MuiCustomInputHorizontal',
  slot: 'root'
})(({ theme }) => ({
  blockSize: '100%',
  display: 'flex',
  gap: theme.spacing(1),
  borderRadius: 'var(--mui-shape-borderRadius)',
  cursor: 'pointer',
  position: 'relative',
  alignItems: 'flex-start',
  border: '1px solid var(--mui-palette-customColors-inputBorder)',
  padding: theme.spacing(4),
  color: 'var(--mui-palette-text-primary)',
  transition: theme.transitions.create(['border-color'], {
    duration: theme.transitions.duration.shorter
  }),
  '&:hover': {
    borderColor: 'var(--mui-palette-action-active)'
  },
  '&.active': {
    borderColor: 'var(--mui-palette-primary-main)',
    '& i, & svg': {
      color: 'var(--mui-palette-primary-main) !important'
    }
  }
}))

const Title = styled(Typography, {
  name: 'MuiCustomInputHorizontal',
  slot: 'title'
})(({ theme }) => ({
  fontWeight: theme.typography.fontWeightMedium,
  color: 'var(--mui-palette-text-primary) !important'
}))

const Content = styled(Typography, {
  name: 'MuiCustomInputHorizontal',
  slot: 'content'
})(({ theme }) => ({
  ...theme.typography.body2
}))

const RadioInput = styled(Radio, {
  name: 'MuiCustomInputHorizontal',
  slot: 'input'
})(({ theme }) => ({
  marginBlockStart: theme.spacing(-0.25),
  marginInlineStart: theme.spacing(-0.25)
}))

const HorizontalInputSelect = props => {
  // Props
  const { type, data, name, selected, gridProps, handleChange, color = 'primary' } = props

  // Vars
  const { title, value, content = [] } = data

  return (
    <Grid item {...gridProps}>
      <Root
        onClick={() => {
          handleChange(value)
        }}
        className={classnames({
          active: type === 'radio' ? selected === value : selected.includes(value)
        })}
      >
        <RadioInput name={name} color={color} value={value} checked={selected === value} />
        {/* <RadioInput name={name} color={color} value={value} onChange={handleChange} checked={selected === value} /> */}

        <Grid className='flex flex-col bs-full is-full gap-1.5'>
          <div className='flex items-start justify-between is-full mbs-1.5'>
            {typeof title === 'string' ? <Title>{title}</Title> : title}
          </div>
          {typeof content === 'string' ? (
            <Content>{content}</Content>
          ) : (
            <div className='flex flex-row flex-wrap gap-1.5'>
              {content.map((item, index) => (
                <Image key={index} src={item} alt={title} width={50} height={50} />
              ))}
            </div>
          )}
        </Grid>
      </Root>
    </Grid>
  )
}

export default HorizontalInputSelect
