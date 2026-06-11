import React from 'react'
import UserManagement from './UserManagement'

export default function Staff() {
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <header className="page-head">
        <h1>Staff</h1>
      </header>
      <p style={{ color: 'var(--muted)', marginTop: -8, marginBottom: 20, fontSize: 14 }}>
        Manage your team's access and roles. Invited staff receive an email to set their password.
      </p>
      <UserManagement />
    </div>
  )
}
