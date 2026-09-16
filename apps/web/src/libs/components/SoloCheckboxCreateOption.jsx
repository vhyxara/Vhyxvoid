// import * as React from 'react'
// import TextField from '@mui/material/TextField'
// import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
// import CustomTextField from '@/@core/components/mui/TextField'

// const filter = createFilterOptions()

// export default function FreeSoloCreateOption(
//   { initialOptions = [], label, placeholder, onChange, optionKey, error, helperText, target, ...props },
//   ref
// ) {
//   const [value, setValue] = React.useState('')

//   return (
//     <Autocomplete
//       value={value}
//       onChange={(event, newValue) => {
//         if (typeof newValue === 'string') {
//           setValue(newValue ?? '')
//         } else if (newValue && newValue.inputValue) {
//           // Create a new value from the user input
//           setValue(newValue.inputValue)
//         } else {
//           setValue(newValue)
//         }
//       }}
//       filterOptions={(options, params) => {
//         const filtered = filter(options, params)

//         const { inputValue } = params
//         // Suggest the creation of a new value
//         const isExisting = options.some(option => inputValue.toLowerCase() === option.toLowerCase())
//         if (inputValue !== '' && !isExisting) {
//           filtered.push(`Add "${inputValue}"`)
//         }

//         return filtered
//       }}
//       selectOnFocus
//       clearOnBlur
//       handleHomeEndKeys
//       id='free-solo-with-text-demo'
//       options={initialOptions}
//       getOptionLabel={option => {
//         // // Value selected with enter, right from the input
//         // if (typeof option === 'string') {
//         //   return option
//         // }
//         // // Add "xxx" option created dynamically
//         // if (option.inputValue) {
//         //   return option.inputValue
//         // }
//         if (option.startsWith('Add "')) {
//           return option.replace(/^Add "/, '').replace(/"$/, '')
//         }
//         // Regular option
//         return option
//       }}
//       onChan
//       renderOption={(props, option) => {
//         const { key, ...optionProps } = props
//         return (
//           <li key={key} {...optionProps}>
//             {option}
//           </li>
//         )
//       }}
//       sx={{ width: 300 }}
//       freeSolo
//       renderInput={params => (
//         <CustomTextField
//           {...params}
//           label={label}
//           placeholder={placeholder}
//           helperText={error ? helperText || 'invalid input' : ''}
//           error={error}
//         />
//       )}
//     />
//   )
// }

'use client'

import React, { forwardRef, useEffect, useState } from 'react'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import CustomTextField from '@/@core/components/mui/TextField'

const filter = createFilterOptions({
  matchFrom: 'start',
  stringify: option => option
})

const FreeSoloCreateOption = forwardRef(
  ({ initialOptions = [], label, placeholder, onChange, error, helperText, value, ...props }, ref) => {
    const [options, setOptions] = useState([])

    useEffect(() => {
      setOptions(initialOptions || [])
    }, [initialOptions])

    const handleChange = (event, newValue, reason) => {
      if (typeof newValue !== 'string') {
        onChange(event, '')
        return
      }

      // Handle "Add xxx"
      if (newValue.startsWith('Add "')) {
        const createdValue = newValue.slice(5, -1)

        setOptions(prev => (prev.includes(createdValue) ? prev : [...prev, createdValue]))

        onChange(event, createdValue)
        return
      }

      onChange(event, newValue)
    }

    return (
      <Autocomplete
        {...props}
        ref={ref}
        freeSolo
        selectOnFocus
        clearOnBlur
        handleHomeEndKeys
        options={options}
        value={value || ''}
        onChange={handleChange}
        filterOptions={(options, params) => {
          const filtered = filter(options, params)
          const inputValue = params.inputValue

          if (inputValue !== '' && !options.includes(inputValue)) {
            filtered.push(`Add "${inputValue}"`)
          }

          return filtered
        }}
        getOptionLabel={option =>
          option.startsWith('Add "') ? option.replace(/^Add "/, '').replace(/"$/, '') : option
        }
        renderOption={(props, option) => <li {...props}>{option}</li>}
        renderInput={params => (
          <CustomTextField
            {...params}
            label={label}
            placeholder={placeholder}
            error={error}
            helperText={error ? helperText || 'Invalid input' : ''}
          />
        )}
      />
    )
  }
)

export default FreeSoloCreateOption
