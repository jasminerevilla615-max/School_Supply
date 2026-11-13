import { useState } from 'react'
import './product-photo.css'

function ProductPhoto({ src, alt, className = '' }) {
  const [failedSource, setFailedSource] = useState('')
  if (!src || failedSource === src) {
    return <span className={`product-photo-missing ${className}`} role="img" aria-label={`${alt} photo needed`}>Photo needed</span>
  }

  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailedSource(src)} />
}

export default ProductPhoto
