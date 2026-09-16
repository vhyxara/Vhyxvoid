import { useState, forwardRef, useEffect } from 'react'

// MUI Imports
import { Grid, IconButton } from '@mui/material'

// Third-party Imports
import { format, subDays } from 'date-fns'

// Component Imports
import AppReactDatepicker from '@/libs/styles/AppReactDatepicker'
import CustomTextField from '@core/components/mui/TextField'
import { toast } from 'react-toastify'
import DeleteConfirmation from './DeleteConfirmation'
import fetchData from '@/utils/fetchData'

export default function CustomDatePicker({
  label = 'Select Date Range',
  initialStartDate = subDays(new Date(), 6), // Default: Last 7 Days
  initialEndDate = new Date(), // Default: Today
  onApplyRange = () => {}, // External handler for applying the range
  deleteUrl = null,
  title = 'Are you sure you want to delete',
  content = 'Are you sure you want to permanently delete',
  icon = 'tabler-trash',
  onSuccessCallback = () => {},
  buttonText = '',
  confirmButtonColor = 'error',
  confirmButtonText = 'Yes, delete',
  method = 'DELETE',
  onDelete = null,
  className,
  deleteProps,
  succesMessage = 'Successfully Deleted'
}) {
  const [startDate, setStartDate] = useState(initialStartDate)
  const [endDate, setEndDate] = useState(initialEndDate)
  const [selectedRange, setSelectedRange] = useState({ from: initialStartDate, to: initialEndDate })
  console.log(method, 'method')
  useEffect(() => {
    setSelectedRange({ from: startDate, to: endDate })
  }, [startDate, endDate])

  const handleApplyRange = () => {
    if (startDate && endDate) {
      onApplyRange({
        from: format(startDate, 'dd/MM/yyyy'),
        to: format(endDate, 'dd/MM/yyyy')
      })
    }
  }

  const handleDelete = async () => {
    if (onDelete) return onDelete()
    if (!deleteUrl) return toast.error('Delete URL is not provided')
    // const url = `/admin/admins/deletePanelLogs`

    const formatData = {
      from: format(startDate, 'dd/MM/yyyy'),
      to: format(endDate, 'dd/MM/yyyy')
    }

    try {
      const response = await fetchData(deleteUrl, method, formatData)

      if (!response.success) {
        toast.error(response.message)
      } else {
        toast.success(response.message || succesMessage)
        onSuccessCallback()
      }
    } catch (error) {
      toast.error(error.message || 'An error occurred')
    } finally {
    }
  }
  const handleOnChangeRange = dates => {
    console.log(dates, 'dates')
    const [start, end] = dates || []
    setStartDate(start || null)
    setEndDate(end || null)
  }

  const CustomInput = forwardRef((props, ref) => {
    const { label, start, end, ...rest } = props
    const startDateFormatted = start ? format(start, 'dd/MM/yyyy') : ''
    const endDateFormatted = end !== null ? ` - ${format(end, 'dd/MM/yyyy')}` : null
    const value = `${startDateFormatted}${endDateFormatted !== null ? endDateFormatted : ''}`

    return (
      <div className={`flex items-end justify-center gap-2 ${className}`}>
        <CustomTextField fullWidth inputRef={ref} {...rest} label={label} value={value} />
        {/* <IconButton onClick={handleApplyRange}>
          <i className='tabler-circle-check text-primary' />
        </IconButton> */}
        <DeleteConfirmation
          title={title}
          confirmButtonText={confirmButtonText}
          buttonVariant='contained'
          icon={icon}
          content={`${content} from ${startDate && format(startDate, 'dd/MM/yyyy')} to ${endDate && format(endDate, 'dd/MM/yyyy')}? This action is irreversible.`}
          onDelete={handleDelete}
          buttonText={buttonText}
          confirmButtonColor={confirmButtonColor}
          method={method}
          {...deleteProps}
        />
      </div>
    )
  })

  return (
    <div>
      <div className='flex gap-3'>
        <Grid item xs={12}>
          <AppReactDatepicker
            selectsRange
            monthsShown={2}
            startDate={startDate}
            endDate={endDate}
            selected={startDate}
            maxDate={new Date()}
            shouldCloseOnSelect={false}
            id='date-range-picker-months'
            onChange={handleOnChangeRange}
            customInput={<CustomInput label={label} end={endDate} start={startDate} />}
          />
        </Grid>
      </div>
    </div>
  )
}

// export default function CustomDatePicker({
//   label = 'Select Date Range',
//   initialStartDate = subDays(new Date(), 6), // Default: Last 7 Days
//   initialEndDate = new Date(), // Default: Today
//   onApplyRange = () => {}, // External handler for applying the range
//   deleteUrl = null,
//   name = '',
//   icon = 'tabler-trash',
//   onSuccessCallback = () => {}
// }) {
//   const [startDate, setStartDate] = useState(initialStartDate)
//   const [endDate, setEndDate] = useState(initialEndDate)
//   const [selectedRange, setSelectedRange] = useState({ from: initialStartDate, to: initialEndDate })

//   useEffect(() => {
//     setSelectedRange({ from: startDate, to: endDate })
//   }, [startDate, endDate])

//   const handleApplyRange = () => {
//     if (startDate && endDate) {
//       onApplyRange({
//         from: format(startDate, 'dd/MM/yyyy'),
//         to: format(endDate, 'dd/MM/yyyy')
//       })
//     }
//   }

//   const handleDelete = async () => {
//     if (!deleteUrl) return toast.error('Delete URL is not provided')
//     // const url = `/admin/admins/deletePanelLogs`

//     const formatData = {
//       from: format(startDate, 'dd/MM/yyyy'),
//       to: format(endDate, 'dd/MM/yyyy')
//     }

//     try {
//       const response = await fetchData(deleteUrl, 'DELETE', formatData)

//       if (!response.success) {
//         toast.error(response.message)
//       } else {
//         toast.success(response.message || 'Successfully Deleted')
//         onSuccessCallback()
//       }
//     } catch (error) {
//       toast.error(error.message || 'An error occurred')
//     } finally {
//     }
//   }
//   const handleOnChangeRange = dates => {
//     const [start, end] = dates || []
//     setStartDate(start || null)
//     setEndDate(end || null)
//   }

//   const CustomInput = forwardRef((props, ref) => {
//     const { label, start, end, ...rest } = props
//     const startDateFormatted = start ? format(start, 'dd/MM/yyyy') : ''
//     const endDateFormatted = end !== null ? ` - ${format(end, 'dd/MM/yyyy')}` : null
//     const value = `${startDateFormatted}${endDateFormatted !== null ? endDateFormatted : ''}`

//     return (
//       <div className='flex items-end justify-center'>
//         <CustomTextField fullWidth inputRef={ref} {...rest} label={label} value={value} />
//         {/* <IconButton onClick={handleApplyRange}>
//           <i className='tabler-circle-check text-primary' />
//         </IconButton> */}
//         <DeleteConfirmation
//           title={`Are you sure you want to delete ${name}?`}
//           confirmButtonText='Yes, delete'
//           buttonVariant='contained'
//           icon={icon}
//           content={`Are you sure you want to permanently delete ${name} from ${startDate && format(startDate, 'dd/MM/yyyy')} to ${endDate && format(endDate, 'dd/MM/yyyy')}? This action is irreversible.`}
//           onDelete={handleDelete}
//         />
//       </div>
//     )
//   })

//   return (
//     <div>
//       <div className='flex gap-3'>
//         <Grid item xs={12}>
//           <AppReactDatepicker
//             selectsRange
//             monthsShown={2}
//             startDate={startDate}
//             endDate={endDate}
//             selected={startDate}
//             shouldCloseOnSelect={false}
//             id='date-range-picker-months'
//             onChange={handleOnChangeRange}
//             customInput={<CustomInput label={label} end={endDate} start={startDate} />}
//           />
//         </Grid>
//       </div>
//     </div>
//   )
// }
