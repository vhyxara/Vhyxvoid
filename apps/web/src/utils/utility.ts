import { format } from 'date-fns'

// import { getInitials } from '@/utils/getInitials'
// import CustomAvatar from '@/@core/components/mui/Avatar'

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...'
  }

  return text
}

export const regexString = (str: string): string => {
  const newStr = str?.replace(/_/g, ' ')

  return newStr
}

export const limitArray = [10, 20, 30, 50]

export const formatDate = (dateString: string | Date, formatString: string = 'dd/MM/yyyy HH:mm:a'): string => {
  const date = new Date(dateString)

  return format(date, formatString)
}

export const handleDownload = (fileName: string, fileUrl: string, actionType = 'direct') => {
  const link = document.createElement('a')

  link.href = fileUrl
  link.download = fileName
  link.target = '_blank' // Always safe for new tab usage

  const triggerDownload = () => {
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  switch (actionType) {
    case 'direct':
      triggerDownload()
      break

    case 'openThenDownload':
      window.open(fileUrl, '_blank')
      setTimeout(() => {
        triggerDownload()
      }, 1000)
      break

    case 'openInNewTab':
      window.open(fileUrl, '_blank')
      break

    default:
      console.warn(`Unknown actionType "${actionType}" in handleDownload`)
      break
  }
}

export const isValidUrl = (url: string): boolean => {
  // Check if the URL is valid (either starts with "http://", "https://", or "/")
  const regex = /^(https?:\/\/|\/)/

  return regex.test(url)
}

export const handleEditorChange = (value: string): string => {
  const plainTextWithoutHtml = value
    .replace(/<br\s*\/?>/gi, '\n') // Replace <br> with newline
    .replace(/<\/p>/gi, '\n') // Replace </p> with newline
    .replace(/<[^>]*>/g, '') // Remove all other HTML tags

  // Remove unwanted characters:
  const plainText = plainTextWithoutHtml
    .replace(/\u00A0/g, ' ') // Replace non-breaking spaces with regular spaces
    .replace(/\t+/g, ' ') // Replace tabs with spaces
    .replace(/\r?\n|\r/g, ' ') // Remove all line breaks
    .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
    .replace(/\u200B/g, '') // Remove zero-width spaces
    .replace(/[ ]+/g, ' ')
    .trim() // Trim leading/trailing spaces

  console.log(plainText) // Output the cleaned-up plain text

  return plainText
}

export const getCookie = (name: string): string | null | undefined => {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)

  if (parts.length === 2) return parts?.pop()?.split(';').shift()

  return null
}

// export const getFullName = (firstname: string, lastname: string, defaultName = 'N/A') => {
//   const first = typeof firstname === 'string' ? firstname.trim() : ''
//   const last = typeof lastname === 'string' ? lastname.trim() : ''

//   const fullName = `${first} ${last}`.trim()

//   return fullName || defaultName
// }

export function getDisplayName(firstName?: string, lastName?: string, email?: string, defaultName = 'User'): string {
  const first = firstName?.trim()
  const last = lastName?.trim()

  if (first && last) return `${first} ${last}`
  if (first) return first
  if (email) return email

  return defaultName
}

function appendParams(searchParams: URLSearchParams, obj: any, parentKey?: string) {
  Object.entries(obj).forEach(([key, value]) => {
    const paramKey = parentKey ? `${parentKey}.${key}` : key

    if (value === undefined || value === null || value === '') return

    if (typeof value === 'object' && !Array.isArray(value)) {
      appendParams(searchParams, value, paramKey)
    } else {
      searchParams.append(paramKey, String(value))
    }
  })
}

export function buildQuery(params: Record<string, any>) {
  const searchParams = new URLSearchParams()

  console.log('serParams type', params, typeof params)
  appendParams(searchParams, params)

  return searchParams
}

// createQueryKeys moved to the shared @vhyx/api-kit package (2026-09-15) --
// see TABLE_API_ARCHITECTURE_COMPARISON.md and decision.md. Import it from
// '@vhyx/api-kit' directly rather than re-adding it here.

export const withId = (url: string, id: string) => url.replace(':id', id)

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
export const inr = (val: number) =>
  `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const shortId = (id: string) => id.slice(0, 8) + '…'

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

// export function buildQuery(params: Record<string, any>) {
//   const searchParams = new URLSearchParams()

//   Object.entries(params).forEach(([key, value]) => {
//     if (value === undefined || value === null || value === '' || typeof value === 'object') {
//       return
//     }

//     searchParams.append(key, String(value))
//   })

//   return searchParams.toString()
// }

// export const getAvatar = (params :{ avatar?:string; fullName?:string }):JSX.Element | null => {
//   if (!params) return null
//   const { avatar = null, fullName = 'N/A' } = params
//   console.log('avatar', avatar, 'full name', fullName)
//   console.log(params)
//   // const nameFormat = regexString(fullName)
//   if (avatar) {
//     return <CustomAvatar src={avatar} skin='light' size={34} />
//   } else {
//     return (
//       <CustomAvatar skin='light' size={34}>
//         {getInitials(fullName)}
//       </CustomAvatar>
//     )
//   }
// }
