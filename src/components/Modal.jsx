import React from 'react'

export default function Modal({ title, children, onClose }) {
  return (
    <div
      className="overlay fixed inset-0 grid place-items-center p-5 z-50"
      style={{ background: 'rgba(10,6,2,.52)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="modal bg-surface border border-line rounded-lg w-full max-w-105 max-h-[90vh] overflow-y-auto shadow-lg"
        style={{ padding: '24px 24px 20px' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="m-0 text-lg font-extrabold text-ink">{title}</h2>
          <button
            className="x border-0 bg-transparent text-lg text-muted w-7.5 h-7.5 rounded-sm grid place-items-center transition-all hover:bg-surface-2 hover:text-ink"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
