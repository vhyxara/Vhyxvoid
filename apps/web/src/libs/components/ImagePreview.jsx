import { useState } from 'react'

export default function ImagePreview({ src, alt }) {
  const [error, setError] = useState(false)

  const fallback = '/images/icons/default-image.jpg'

  return (
    <img
      src={error ? fallback : src}
      alt={alt}
      className='w-24 h-14 object-cover rounded border'
      onError={() => setError(true)}
      onLoad={() => setError(false)}
    />
  )
}
