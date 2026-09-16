// MUI Imports
import Typography from '@mui/material/Typography'

const AddHeader = ({ title, className }) => {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-6 ${className}`}>
      {/* <div> */}
      <Typography className='mbe-1 text-[22px] text-textPrimary'>{title}</Typography>
      {/* </div> */}
    </div>
  )
}

export default AddHeader
