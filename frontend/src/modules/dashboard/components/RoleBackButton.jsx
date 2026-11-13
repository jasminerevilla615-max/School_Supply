import { useEffect, useRef } from 'react'

function fieldValue(field) {
  if (field.type === 'checkbox' || field.type === 'radio') return [field.value, field.checked]
  if (field.type === 'file') return Array.from(field.files || []).map(file => `${file.name}:${file.size}:${file.lastModified}`)
  if (field.multiple) return Array.from(field.selectedOptions, option => option.value)
  return field.value
}

function RoleBackButton({ onClick }) {
  const buttonRef = useRef(null)
  const formSnapshots = useRef(new WeakMap())

  useEffect(() => {
    const body = buttonRef.current?.parentElement
    if (!body) return undefined

    const captureForm = event => {
      const form = event.target.form
      if (!form || formSnapshots.current.has(form)) return
      const fields = Array.from(form.elements)
        .filter(field => field.matches('input, textarea, select') && !['button', 'submit', 'reset', 'hidden'].includes(field.type))
        .map(field => [field, fieldValue(field)])
      formSnapshots.current.set(form, fields)
    }

    body.addEventListener('focusin', captureForm)
    body.addEventListener('beforeinput', captureForm)
    return () => {
      body.removeEventListener('focusin', captureForm)
      body.removeEventListener('beforeinput', captureForm)
    }
  }, [])

  function handleBack() {
    const body = buttonRef.current?.parentElement
    const hasUnsavedChanges = body && Array.from(body.querySelectorAll('form')).some(form => {
      const fields = formSnapshots.current.get(form)
      return fields?.some(([field, initialValue]) => JSON.stringify(fieldValue(field)) !== JSON.stringify(initialValue))
    })
    if (hasUnsavedChanges && !window.confirm('You may have unsaved changes. Discard them and go back?')) return
    onClick()
  }

  return <button ref={buttonRef} className="role-back-button" type="button" onClick={handleBack}>
    <span aria-hidden="true">←</span> Back
  </button>
}

export default RoleBackButton
