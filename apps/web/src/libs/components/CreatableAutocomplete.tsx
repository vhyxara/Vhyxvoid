// 'use client'

// import { useState } from 'react'

// import Autocomplete, { createFilterOptions, type FilterOptionsState } from '@mui/material/Autocomplete'

// import CustomTextField from '@core/components/mui/TextField'

// /* ---------- Types ---------- */

// type BaseOption = {
//   label: string
// }

// type CreatableOption =
//   | BaseOption
//   | {
//       inputValue: string
//       label: string
//     }

// type Props = {
//   options?: BaseOption[]
//   label?: string
//   onChange?: (value: string | null) => void
// }

// const filter = createFilterOptions<CreatableOption>()

// /* ---------- Component ---------- */

// export default function CreatableAutocomplete({ options = [], label = 'Select or create option', onChange }: Props) {
//   const [value, setValue] = useState<CreatableOption | null>(null)

//   return (
//     <Autocomplete
//       value={value}
//       freeSolo
//       selectOnFocus
//       clearOnBlur
//       handleHomeEndKeys
//       options={options}
//       filterOptions={(options, params: FilterOptionsState<CreatableOption>) => {
//         const filtered = filter(options, params)

//         const { inputValue } = params
//         const isExisting = options.some(option => option.label === inputValue)

//         if (inputValue !== '' && !isExisting) {
//           filtered.push({
//             inputValue,
//             label: `Add "${inputValue}"`
//           })
//         }

//         return filtered
//       }}
//       getOptionLabel={option => {
//         if (typeof option === 'string') {
//           return option
//         }

//         if ('inputValue' in option) {
//           return option.inputValue
//         }

//         return option.label
//       }}
//       onChange={(_, newValue) => {
//         if (typeof newValue === 'string') {
//           setValue({ label: newValue })
//           onChange?.(newValue)
//         } else if (newValue && 'inputValue' in newValue) {
//           setValue({ label: newValue.inputValue })

//           onChange?.(newValue.inputValue)
//         } else {
//           setValue(newValue)
//           onChange?.(newValue?.label ?? null)
//         }
//       }}
//       renderInput={params => <CustomTextField {...params} label={label} />}
//     />
//   )
// }
'use client'

import { useMemo, useState, useEffect } from 'react'

import Autocomplete, { createFilterOptions, type AutocompleteProps } from '@mui/material/Autocomplete'

import CustomTextField from '@core/components/mui/TextField'

/* ---------- Types ---------- */

type Props = {
  options?: string[]
  initialOptions?: string[]
  value?: string | null
  defaultValue?: string | null
  label?: string
  placeholder?: string
  onChange?: (value: string | null) => void
  error?: boolean
  helperText?: string
  slotProps?: {
    input?: React.InputHTMLAttributes<HTMLInputElement>
  }
} & Omit<AutocompleteProps<string, false, false, true>, 'renderInput' | 'options' | 'onChange' | 'value'>

/* ---------- Utils ---------- */

const filter = createFilterOptions<string>()

/* ---------- Component ---------- */

export default function CreatableAutocomplete({
  options = [],
  initialOptions = [],
  value: controlledValue,
  defaultValue = null,
  label,
  placeholder,
  onChange,
  error,
  helperText,

  ...props
}: Props) {
  const { slotProps, ...autocompleteProps } = props

  const [internalValue, setInternalValue] = useState<string | null>(controlledValue ?? defaultValue)

  const [inputValue, setInputValue] = useState('')

  const isControlled = controlledValue !== undefined

  /* ---------- Sync controlled value ---------- */

  useEffect(() => {
    if (isControlled) {
      setInternalValue(controlledValue ?? null)
    }
  }, [controlledValue, isControlled])

  /* ---------- Merge Options ---------- */

  const mergedOptions = useMemo(() => {
    const all = [...options, ...initialOptions]

    return Array.from(new Set(all))
  }, [options, initialOptions])

  /* ---------- Handle Change ---------- */

  const handleChange = (_: any, newValue: string | null) => {
    if (!newValue) {
      if (!isControlled) setInternalValue(null)
      onChange?.(null)

      return
    }

    let finalValue = newValue

    if (newValue.startsWith('Add "')) {
      finalValue = newValue.replace(/^Add "|\"$/g, '')
    }

    finalValue = finalValue.trim()

    if (!isControlled) setInternalValue(finalValue)

    onChange?.(finalValue)
  }

  /* ---------- Render ---------- */

  return (
    <Autocomplete<string, false, false, true>
      freeSolo
      options={mergedOptions}
      value={internalValue}
      inputValue={inputValue}
      onInputChange={(_, newInput) => {
        setInputValue(newInput.trimStart())
      }}
      filterOptions={(opts, params) => {
        const filtered = filter(opts, params)
        const trimmed = params.inputValue.trim()

        const isExisting = opts.some(option => option.toLowerCase() === trimmed.toLowerCase())

        if (trimmed !== '' && !isExisting) {
          filtered.push(`Add "${trimmed}"`)
        }

        return filtered
      }}
      onChange={handleChange}
      renderInput={params => (
        <CustomTextField
          {...params}
          label={label}
          placeholder={placeholder}
          error={error}
          helperText={helperText}
          inputProps={{
            ...params.inputProps,
            ...slotProps?.input
          }}
        />
      )}
      {...autocompleteProps}
    />
  )
}
