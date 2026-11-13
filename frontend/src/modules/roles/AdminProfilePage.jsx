import { useEffect, useState } from 'react'
import { changeAdminPassword, getAdminProfile, getAdminProfileActivity, updateAdminProfile } from '../../lib/api.js'
import './admin-profile.css'

const emptyProfile = { name: '', username: '', email: '', role: 'admin', status: '', active: true, created_at: null, updated_at: null, last_login: null, last_logout: null }
const emptyPassword = { current: '', next: '', confirmation: '' }

function formatTimestamp(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function PasswordField({ id, label, value, visible, onChange, onToggle, autoComplete }) {
  return (
    <div className="profile-field">
      <label htmlFor={id}>{label}</label>
      <span className="profile-password-control">
        <input id={id} type={visible ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} required />
        <button type="button" onClick={onToggle} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}>{visible ? 'Hide' : 'Show'}</button>
      </span>
    </div>
  )
}

function AdminProfilePage({ onProfileUpdated }) {
  const [profile, setProfile] = useState(emptyProfile)
  const [draft, setDraft] = useState({ name: '', username: '', email: '' })
  const [activity, setActivity] = useState([])
  const [profileErrors, setProfileErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [password, setPassword] = useState(emptyPassword)
  const [passwordVisibility, setPasswordVisibility] = useState({ current: false, next: false, confirmation: false })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [activityError, setActivityError] = useState('')

  async function loadProfile() {
    setLoading(true)
    setError('')
    try {
      const result = await getAdminProfile()
      setProfile(result)
      setDraft({ name: result.name || '', username: result.username || '', email: result.email || '' })
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadActivity() {
    setActivityLoading(true)
    setActivityError('')
    try {
      setActivity(await getAdminProfileActivity())
    } catch (loadError) {
      setActivityError(loadError.message)
    } finally {
      setActivityLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getAdminProfile().then(result => {
      if (!active) return
      setProfile(result)
      setDraft({ name: result.name || '', username: result.username || '', email: result.email || '' })
    }).catch(loadError => {
      if (active) setError(loadError.message)
    }).finally(() => {
      if (active) setLoading(false)
    })
    getAdminProfileActivity().then(result => {
      if (active) setActivity(result)
    }).catch(loadError => {
      if (active) setActivityError(loadError.message)
    }).finally(() => {
      if (active) setActivityLoading(false)
    })
    return () => { active = false }
  }, [])

  async function saveProfile(event) {
    event.preventDefault()
    setSavingProfile(true)
    setError('')
    setMessage('')
    setProfileErrors({})
    try {
      const result = await updateAdminProfile(draft)
      setProfile(result.profile)
      setDraft({ name: result.profile.name, username: result.profile.username, email: result.profile.email })
      setEditing(false)
      onProfileUpdated?.(result.profile)
      setMessage(result.message)
      await loadActivity()
    } catch (saveError) {
      setError(saveError.message)
      const details = {}
      if (/full name/i.test(saveError.message)) details.name = saveError.message
      if (/username/i.test(saveError.message)) details.username = saveError.message
      if (/email/i.test(saveError.message)) details.email = saveError.message
      setProfileErrors(details)
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
      const result = await changeAdminPassword(password.current, password.next, password.confirmation)
      setPassword(emptyPassword)
      setMessage(result.message)
      await loadActivity()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingPassword(false)
    }
  }

  function cancelProfileEdit() {
    setDraft({ name: profile.name || '', username: profile.username || '', email: profile.email || '' })
    setProfileErrors({})
    setEditing(false)
  }

  function updateDraftField(field, value) {
    setDraft(current => ({ ...current, [field]: value }))
    setProfileErrors(current => ({ ...current, [field]: '' }))
  }

  const initials = (profile.name || profile.username || 'A').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  const accountStatus = profile.status || (profile.active ? 'Active' : 'Inactive')

  if (loading) return <section className="admin-profile-page"><p className="admin-profile-loading" role="status">Loading administrator profile…</p></section>
  if (error && !profile.id) return <section className="admin-profile-page"><div className="admin-profile-feedback is-error" role="alert">{error}<button type="button" onClick={loadProfile}>Retry</button></div></section>

  return (
    <section className="admin-profile-page">
      <header className="admin-profile-heading">
        <div><p className="eyebrow">ACCOUNT AND SECURITY</p><h2>Admin Profile</h2><p>Manage your administrator details and account security.</p></div>
      </header>
      {(message || error) && <div className={`admin-profile-feedback ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button type="button" onClick={() => { setError(''); setMessage('') }} aria-label="Dismiss message">×</button></div>}

      <article className="admin-profile-identity admin-profile-card">
        <span className="admin-profile-avatar" aria-hidden="true">{initials}</span>
        <div className="admin-profile-identity-copy">
          <p className="eyebrow">ADMINISTRATOR ACCOUNT</p>
          <h3>{profile.name}</h3>
          <p>@{profile.username} <span>·</span> {profile.email}</p>
          <div className="admin-profile-badges"><span>Administrator</span><span className={profile.active ? 'is-active' : 'is-inactive'}>{accountStatus}</span></div>
        </div>
        {!editing && <button className="admin-profile-secondary" type="button" onClick={() => { setError(''); setMessage(''); setEditing(true) }}>Edit Profile</button>}
      </article>

      <div className="admin-profile-grid">
        <article className="admin-profile-card">
          <div className="admin-profile-card-heading"><div><p className="eyebrow">PERSONAL INFORMATION</p><h3>Profile details</h3></div></div>
          {editing ? (
            <form className="admin-profile-form" onSubmit={saveProfile}>
              <label className="profile-field" htmlFor="admin-profile-name"><span>Full name</span><input id="admin-profile-name" aria-invalid={Boolean(profileErrors.name)} aria-describedby={profileErrors.name ? 'admin-profile-name-error' : undefined} value={draft.name} onChange={event => updateDraftField('name', event.target.value)} maxLength="255" required autoComplete="name" />{profileErrors.name && <small id="admin-profile-name-error" className="profile-field-error">{profileErrors.name}</small>}</label>
              <label className="profile-field" htmlFor="admin-profile-username"><span>Username</span><input id="admin-profile-username" aria-invalid={Boolean(profileErrors.username)} aria-describedby={profileErrors.username ? 'admin-profile-username-error' : undefined} value={draft.username} onChange={event => updateDraftField('username', event.target.value)} maxLength="255" required autoComplete="username" />{profileErrors.username && <small id="admin-profile-username-error" className="profile-field-error">{profileErrors.username}</small>}</label>
              <label className="profile-field" htmlFor="admin-profile-email"><span>Email address</span><input id="admin-profile-email" aria-invalid={Boolean(profileErrors.email)} aria-describedby={profileErrors.email ? 'admin-profile-email-error' : undefined} type="email" value={draft.email} onChange={event => updateDraftField('email', event.target.value)} maxLength="255" required autoComplete="email" />{profileErrors.email && <small id="admin-profile-email-error" className="profile-field-error">{profileErrors.email}</small>}</label>
              <div className="admin-profile-form-actions"><button className="admin-profile-secondary" type="button" onClick={cancelProfileEdit} disabled={savingProfile}>Cancel</button><button className="admin-profile-primary" type="submit" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save Changes'}</button></div>
            </form>
          ) : (
            <dl className="admin-profile-details">
              <div><dt>Full name</dt><dd>{profile.name || 'Not set'}</dd></div>
              <div><dt>Username</dt><dd>{profile.username || 'Not set'}</dd></div>
              <div><dt>Email address</dt><dd>{profile.email || 'Not set'}</dd></div>
              <div><dt>Role</dt><dd>Administrator</dd></div>
            </dl>
          )}
        </article>

        <article className="admin-profile-card">
          <div className="admin-profile-card-heading"><div><p className="eyebrow">PASSWORD SECURITY</p><h3>Change password</h3></div></div>
          <p className="admin-profile-hint">Use at least 8 characters, including uppercase, lowercase, and a number.</p>
          <form className="admin-profile-form" onSubmit={savePassword}>
            <PasswordField id="current-password" label="Current password" value={password.current} visible={passwordVisibility.current} onChange={event => setPassword({ ...password, current: event.target.value })} onToggle={() => setPasswordVisibility({ ...passwordVisibility, current: !passwordVisibility.current })} autoComplete="current-password" />
            <PasswordField id="new-password" label="New password" value={password.next} visible={passwordVisibility.next} onChange={event => setPassword({ ...password, next: event.target.value })} onToggle={() => setPasswordVisibility({ ...passwordVisibility, next: !passwordVisibility.next })} autoComplete="new-password" />
            <PasswordField id="confirm-new-password" label="Confirm new password" value={password.confirmation} visible={passwordVisibility.confirmation} onChange={event => setPassword({ ...password, confirmation: event.target.value })} onToggle={() => setPasswordVisibility({ ...passwordVisibility, confirmation: !passwordVisibility.confirmation })} autoComplete="new-password" />
            <div className="admin-profile-form-actions"><button className="admin-profile-secondary" type="button" onClick={() => setPassword(emptyPassword)} disabled={savingPassword}>Clear</button><button className="admin-profile-primary" type="submit" disabled={savingPassword}>{savingPassword ? 'Updating…' : 'Update Password'}</button></div>
          </form>
        </article>

        <article className="admin-profile-card admin-profile-security">
          <div className="admin-profile-card-heading"><div><p className="eyebrow">ACCOUNT SECURITY</p><h3>Security information</h3></div></div>
          <dl className="admin-profile-details">
            <div><dt>Role</dt><dd>Administrator</dd></div>
            <div><dt>Account status</dt><dd>{accountStatus}</dd></div>
            <div><dt>Last successful login</dt><dd>{formatTimestamp(profile.last_login)}</dd></div>
            <div><dt>Last logout</dt><dd>{formatTimestamp(profile.last_logout)}</dd></div>
            <div><dt>Account created</dt><dd>{formatTimestamp(profile.created_at)}</dd></div>
          </dl>
          <p className="admin-profile-hint">Password change history is not recorded by this application.</p>
        </article>

        <article className="admin-profile-card admin-profile-activity">
          <div className="admin-profile-card-heading"><div><p className="eyebrow">RECENT ACCOUNT EVENTS</p><h3>Account activity</h3></div></div>
          {activityLoading ? <p className="admin-profile-muted" role="status">Loading account activity…</p> : activityError ? <p className="admin-profile-inline-error" role="alert">{activityError}</p> : activity.length ? (
            <ol className="admin-profile-activity-list">
              {activity.map(item => <li key={item.id}><span className="admin-profile-activity-marker" aria-hidden="true" /><div><strong>{item.description}</strong><small>{item.module || item.action}</small></div><time dateTime={item.created_at}>{formatTimestamp(item.created_at)}</time></li>)}
            </ol>
          ) : <p className="admin-profile-muted">No account activity has been recorded.</p>}
        </article>
      </div>
    </section>
  )
}

export default AdminProfilePage
