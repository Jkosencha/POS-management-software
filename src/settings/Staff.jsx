import React from 'react'
import UserManagement from './UserManagement'

export default function Staff() {
  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <header className="page-head">
        <h1>Staff</h1>
      </header>
      <p className="page-sub">
        Manage your team's access and roles. Invited staff receive an email to set their password.
      </p>
      <UserManagement />
    </div>
  )
}
