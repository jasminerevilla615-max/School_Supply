import { useEffect, useRef, useState } from 'react'
import { changeStaffPassword, getStaffProfile, getStaffProfileActivity, removeStaffProfilePhoto, updateStaffProfile, uploadStaffProfilePhoto } from '../../lib/api.js'
import './staff-account.css'

const emptyPassword = { current: '', next: '', confirmation: '' }

function formatTimestamp(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatDuration(seconds = 0) {
  const minutes = Math.max(0, Math.floor(Number(seconds || 0) / 60))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

function StaffAccountPage({ view, darkMode, onThemeChange, onProfileUpdated }) {
  const [profile, setProfile] = useState(null)
  const [draft, setDraft] = useState({ name: '', username: '', email: '', contact_number: '' })
  const [activity, setActivity] = useState([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activityLoaded, setActivityLoaded] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [password, setPassword] = useState(emptyPassword)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const photoInputRef = useRef(null)

  useEffect(() => {
    let active = true
    getStaffProfile().then(result => {
      if (!active) return
      setProfile(result)
      setDraft({
        name: result.name || '',
        username: result.username || '',
        email: result.email || '',
        contact_number: result.contact_number || '',
      })
    }).catch(loadError => {
      if (active) setError(loadError.message)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (view !== 'activity') return undefined
    let active = true
    getStaffProfileActivity().then(items => {
      if (active) setActivity(items)
    }).catch(loadError => {
      if (active) setError(loadError.message)
    }).finally(() => {
      if (active) setActivityLoaded(true)
    })
    return () => { active = false }
  }, [view])

  function applyProfile(nextProfile) {
    setProfile(nextProfile)
    setDraft({
      name: nextProfile.name || '',
      username: nextProfile.username || '',
      email: nextProfile.email || '',
      contact_number: nextProfile.contact_number || '',
    })
    onProfileUpdated?.(nextProfile)
  }

  async function saveProfile(event) {
    event.preventDefault()
    setSavingProfile(true)
    setError('')
    setMessage('')
    try {
      const result = await updateStaffProfile(draft)
      applyProfile(result.profile)
      setEditing(false)
      setMessage(result.message)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(event) {
    event.preventDefault()
    setSavingPassword(true)
    setError('')
    setMessage('')
    try {
      const result = await changeStaffPassword(password.current, password.next, password.confirmation)
      setPassword(emptyPassword)
      setMessage(result.message)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingPassword(false)
    }
  }

  async function changePhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG, or WEBP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('The uploaded image exceeds the 5 MB limit.')
      return
    }
    setUploadingPhoto(true)
    setError('')
    setMessage('')
    try {
      const result = await uploadStaffProfilePhoto(file)
      applyProfile(result.profile)
      setMessage(result.message)
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function removePhoto() {
    setUploadingPhoto(true)
    setError('')
    setMessage('')
    try {
      const result = await removeStaffProfilePhoto()
      applyProfile(result.profile)
      setMessage(result.message)
    } catch (removeError) {
      setError(removeError.message)
    } finally {
      setUploadingPhoto(false)
    }
  }

  function cancelEdit() {
    setDraft({
      name: profile?.name || '',
      username: profile?.username || '',
      email: profile?.email || '',
      contact_number: profile?.contact_number || '',
    })
    setEditing(false)
    setError('')
    setMessage('')
  }

  const initials = (profile?.name || profile?.username || 'S').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  const titles = { profile: 'My Profile', settings: 'Account Settings', activity: 'Account Activity' }
  const activityLoading = view === 'activity' && !activityLoaded

  if (loading) return <section className="staff-account-page"><p className="staff-account-loading" role="status">Loading your account…</p></section>
  if (!profile) return <section className="staff-account-page"><div className="staff-account-feedback is-error" role="alert">{error || 'Unable to load your profile.'}<button type="button" onClick={() => window.location.reload()}>Reload</button></div></section>

  return (
    <section className="staff-account-page">
      <header className="staff-account-heading">
        <div><p className="eyebrow">STAFF ACCOUNT</p><h2>{titles[view] || titles.profile}</h2><p>Manage your personal information, security, and recent sign-ins.</p></div>
      </header>
      {(message || error) && <div className={`staff-account-feedback ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button type="button" onClick={() => { setError(''); setMessage('') }} aria-label="Dismiss message">×</button></div>}

      {view === 'profile' && <>
        <article className="staff-account-identity staff-account-card">
          <div className="staff-account-avatar">
            {profile.profile_image_url ? <img src={profile.profile_image_url} alt={`${profile.name || 'Staff'} profile`} /> : <span aria-hidden="true">{initials}</span>}
          </div>
          <div className="staff-account-identity-copy"><p className="eyebrow">YOUR ACCOUNT</p><h3>{profile.name || 'Staff member'}</h3><p>@{profile.username} <span>·</span> {profile.email}</p><div className="staff-account-badges"><span>Staff</span><span className={profile.active ? 'is-active' : 'is-inactive'}>{profile.active ? 'Active' : 'Inactive'}</span></div></div>
          <div className="staff-account-photo-actions">
            <input ref={photoInputRef} className="staff-account-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={changePhoto} aria-label="Choose a profile picture" />
            <button type="button" className="staff-account-secondary" onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>{uploadingPhoto ? 'Updating…' : profile.profile_image_url ? 'Change photo' : 'Upload photo'}</button>
            {profile.profile_image_url && <button type="button" className="staff-account-text-button" onClick={removePhoto} disabled={uploadingPhoto}>Remove</button>}
          </div>
        </article>

        <article className="staff-account-card staff-account-information">
          <div className="staff-account-card-heading"><div><p className="eyebrow">PERSONAL INFORMATION</p><h3>Profile details</h3></div>{!editing && <button type="button" className="staff-account-secondary" onClick={() => { setError(''); setMessage(''); setEditing(true) }}>Edit profile</button>}</div>
          {editing ? <form className="staff-account-form" onSubmit={saveProfile}>
            <label htmlFor="staff-profile-name">Full name<input id="staff-profile-name" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} autoComplete="name" maxLength="255" required /></label>
            <label htmlFor="staff-profile-username">Username<input id="staff-profile-username" value={draft.username} onChange={event => setDraft(current => ({ ...current, username: event.target.value }))} autoComplete="username" maxLength="255" required /></label>
            <label htmlFor="staff-profile-email">Email address<input id="staff-profile-email" type="email" value={draft.email} onChange={event => setDraft(current => ({ ...current, email: event.target.value }))} autoComplete="email" maxLength="255" required /></label>
            <label htmlFor="staff-profile-contact">Contact number<input id="staff-profile-contact" type="tel" value={draft.contact_number} onChange={event => setDraft(current => ({ ...current, contact_number: event.target.value }))} autoComplete="tel" maxLength="32" /></label>
            <div className="staff-account-form-actions"><button type="button" className="staff-account-secondary" onClick={cancelEdit} disabled={savingProfile}>Cancel</button><button type="submit" className="staff-account-primary" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save changes'}</button></div>
          </form> : <dl className="staff-account-details">
            <div><dt>Full name</dt><dd>{profile.name || 'Not set'}</dd></div><div><dt>Username</dt><dd>{profile.username || 'Not set'}</dd></div><div><dt>Email address</dt><dd>{profile.email || 'Not set'}</dd></div><div><dt>Contact number</dt><dd>{profile.contact_number || 'Not provided'}</dd></div><div><dt>Account role</dt><dd>Staff</dd></div><div><dt>Account created</dt><dd>{formatTimestamp(profile.created_at)}</dd></div>
          </dl>}
        </article>
      </>}

      {view === 'settings' && <>
        <article className="staff-account-card staff-account-preferences">
          <div className="staff-account-card-heading"><div><p className="eyebrow">DISPLAY PREFERENCE</p><h3>Appearance</h3></div></div>
          <div className="staff-account-preference-row"><div><strong>Dark mode</strong><small>Saved in this browser using your existing theme preference.</small></div><button type="button" className={`staff-account-switch${darkMode ? ' is-on' : ''}`} role="switch" aria-checked={darkMode} onClick={() => onThemeChange?.(!darkMode)}><span />{darkMode ? 'On' : 'Off'}</button></div>
        </article>
        <article className="staff-account-card staff-account-password">
          <div className="staff-account-card-heading"><div><p className="eyebrow">ACCOUNT SECURITY</p><h3>Change password</h3></div></div>
          <p className="staff-account-hint">Use at least 8 characters, including an uppercase letter, a lowercase letter, and a number. Your current password is required.</p>
          <form className="staff-account-form" onSubmit={savePassword}>
            <label htmlFor="staff-current-password">Current password<input id="staff-current-password" type="password" autoComplete="current-password" value={password.current} onChange={event => setPassword(current => ({ ...current, current: event.target.value }))} required /></label>
            <label htmlFor="staff-new-password">New password<input id="staff-new-password" type="password" autoComplete="new-password" minLength="8" value={password.next} onChange={event => setPassword(current => ({ ...current, next: event.target.value }))} required /></label>
            <label htmlFor="staff-confirm-password">Confirm new password<input id="staff-confirm-password" type="password" autoComplete="new-password" minLength="8" value={password.confirmation} onChange={event => setPassword(current => ({ ...current, confirmation: event.target.value }))} required /></label>
            <div className="staff-account-form-actions"><button type="button" className="staff-account-secondary" onClick={() => setPassword(emptyPassword)} disabled={savingPassword}>Clear</button><button type="submit" className="staff-account-primary" disabled={savingPassword}>{savingPassword ? 'Updating…' : 'Update password'}</button></div>
          </form>
        </article>
      </>}

      {view === 'activity' && <article className="staff-account-card staff-account-activity">
        <div className="staff-account-card-heading"><div><p className="eyebrow">SIGN-IN HISTORY</p><h3>Recent account activity</h3></div></div>
        <p className="staff-account-hint">Shows login and logout sessions recorded by this system. Only your own account history is included.</p>
        {activityLoading ? <p className="staff-account-muted" role="status">Loading account activity…</p> : error ? <p className="staff-account-inline-error" role="alert">{error}</p> : activity.length ? <ol className="staff-account-activity-list">{activity.map(item => <li key={item.id}><span className={`staff-account-activity-marker${item.session_status === 'online' ? ' is-online' : ''}`} aria-hidden="true" /><div><strong>{item.session_status === 'online' ? 'Current session' : 'Sign-in session'}</strong><small>Signed in {formatTimestamp(item.login_time)}</small><small>{item.logout_time ? `Signed out ${formatTimestamp(item.logout_time)}` : item.session_status === 'online' ? 'No logout recorded yet' : 'Logout time not recorded'} · Duration {formatDuration(item.session_duration)}</small></div><span className={`staff-account-session-status${item.session_status === 'online' ? ' is-online' : ''}`}>{item.session_status === 'online' ? 'Active' : 'Ended'}</span></li>)}</ol> : <p className="staff-account-muted">No account sessions have been recorded.</p>}
      </article>}
    </section>
  )
}

export default StaffAccountPage
