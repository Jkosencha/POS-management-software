import React from 'react'
import BrandMark from '../components/BrandMark'

export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-svh grid place-items-center bg-bg p-4">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -right-32 size-[520px] rounded-full bg-accent/15 blur-3xl" />
        <div className="absolute -bottom-48 -left-32 size-[460px] rounded-full bg-chart-2/15 blur-3xl" />
      </div>
      <div className="relative bg-surface rounded-xl shadow-lg w-full max-w-[400px] py-10 px-8 sm:px-9">
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <BrandMark className="size-14 rounded-[16px]" iconSize={26} />
          <h1 className="m-0 text-[22px] font-bold text-ink tracking-tight">{title}</h1>
          {subtitle && <p className="m-0 text-[13.5px] text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}
