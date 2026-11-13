import { useEffect, useState } from 'react'
import { getRegistrationStatus, login, register } from '../../../lib/api.js'

function AuthForm({ onLogin, initialRegisterMode = false }) {
  const [email, setEmail] = useState(() => localStorage.getItem('school-supply-email') || '')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [registerMode, setRegisterMode] = useState(initialRegisterMode)
  const [busy, setBusy] = useState(false)
  const [registrationFull, setRegistrationFull] = useState(false)
  const [registrationStatusError, setRegistrationStatusError] = useState('')

  useEffect(() => {
    if (!registerMode) return undefined
    let active = true
    getRegistrationStatus().then(status => {
      if (!active) return
      const full = !status.available
      setRegistrationFull(full)
      if (full) setRegisterMode(false)
    }).catch(error => {
      if (active) setRegistrationStatusError(error.message)
    })
    return () => { active = false }
  }, [registerMode])

  function switchMode(nextMode) {
    if (busy || (nextMode && registrationFull)) return
    setRegisterMode(nextMode)
    setMessage('')
    setShowPassword(false)
  }

  function submit(event) {
    event.preventDefault()
    if (busy) return
    setMessage('')
    setBusy(true)
    const action = registerMode ? register(name, email, password, confirmPassword) : login(email, password)
    action.then(result => {
      localStorage.setItem('school-supply-email', email)
      if (registerMode) {
        setMessage(result.message)
        setRegisterMode(false)
        setPassword('')
        setConfirmPassword('')
      } else {
        onLogin(result)
      }
    }).catch(error => setMessage(error.message)).finally(() => setBusy(false))
  }

  return (
    <section className="landing-auth-card" aria-label="Account access">
      <div className="landing-auth-heading">
        <h2>{registerMode ? 'Create Account' : 'Welcome Back!'}</h2>
        <p>{registerMode ? 'Join SchoolSupply to get started.' : 'Log in to your account or create a new one.'}</p>
      </div>
      <div className="landing-auth-tabs" role="tablist" aria-label="Choose login or signup">
        <button
          type="button"
          role="tab"
          id="login-tab"
          aria-selected={!registerMode}
          aria-controls="landing-auth-panel"
          className={!registerMode ? 'active' : ''}
          onClick={() => switchMode(false)}
          disabled={busy}
        >
          Log In
        </button>
        <button
          type="button"
          role="tab"
          id="signup-tab"
          aria-selected={registerMode}
          aria-controls="landing-auth-panel"
          className={registerMode ? 'active' : ''}
          onClick={() => switchMode(true)}
          disabled={busy || registrationFull}
        >
          Sign Up
        </button>
      </div>
      <form className="landing-auth-form" id="landing-auth-panel" role="tabpanel" aria-labelledby={registerMode ? 'signup-tab' : 'login-tab'} onSubmit={submit}>
        {registerMode && (
          <label>
            Full Name
            <input type="text" value={name} onChange={event => setName(event.target.value)} placeholder="Your full name" autoComplete="name" required disabled={busy} />
          </label>
        )}
        <label>
          Email Address
          <input
            type={registerMode ? 'email' : 'text'}
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder={registerMode ? 'you@example.com' : 'Enter your email address'}
            autoComplete="username"
            required
            disabled={busy}
          />
        </label>
        <label>
          Password
          <span className="landing-password-field">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder={registerMode ? 'At least 8 characters' : 'Enter your password'}
              autoComplete={registerMode ? 'new-password' : 'current-password'}
              minLength={registerMode ? 8 : undefined}
              required
              disabled={busy}
            />
            <button type="button" className="landing-password-toggle" onClick={() => setShowPassword(show => !show)} aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={busy}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        {registerMode && (
          <label>
            Confirm Password
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={busy}
            />
          </label>
        )}
        <button className="landing-auth-submit" type="submit" disabled={busy || (registerMode && registrationFull)}>
          {busy ? 'Please wait...' : registerMode ? 'Sign Up' : 'Log In'} <span aria-hidden="true">→</span>
        </button>
        {(message || (registerMode && registrationFull) || (registerMode && registrationStatusError)) && (
          <p className={`landing-auth-message${message && !message.toLowerCase().includes('success') && !message.toLowerCase().includes('created') ? ' error' : ''}`} role="status">
            {message || (registrationFull ? 'Customer registration is currently full.' : registrationStatusError)}
          </p>
        )}
      </form>
    </section>
  )
}

export default AuthForm
