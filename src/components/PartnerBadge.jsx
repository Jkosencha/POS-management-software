import React from 'react'
import { cn } from 'cn'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SHARED, SHARED_VALUE, toSelectValue, fromSelectValue } from '../lib/partners'

export function PartnerDot({ color, className }) {
  return <span className={cn('inline-block size-2.5 rounded-full shrink-0', className)} style={{ background: color }} />
}

// Tinted pill in the partner's color, e.g. "● Jane · 12"
export function PartnerBadge({ partner, children, className }) {
  const p = partner || SHARED
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap', className)}
      style={{ background: `color-mix(in srgb, ${p.color} 16%, transparent)`, color: `color-mix(in srgb, ${p.color} 75%, var(--ink))` }}
    >
      <PartnerDot color={p.color} className="size-2" />
      {p.name}{children != null && <span className="font-mono opacity-90">· {children}</span>}
    </span>
  )
}

// Owner picker: every partner plus Shared. value: partner id, null (Shared) or
// undefined (nothing chosen yet, or anyLabel's "no preference" option)
export function PartnerSelect({ partners, value, onChange, includeShared = true, anyLabel, placeholder = 'Choose owner', className, size }) {
  const ANY = 'any'
  const current = value === undefined ? (anyLabel ? ANY : '') : toSelectValue(value)
  return (
    <Select
      value={current}
      onValueChange={v => onChange(v === ANY ? undefined : fromSelectValue(v))}
    >
      <SelectTrigger className={className} size={size}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {anyLabel && <SelectItem value={ANY}>{anyLabel}</SelectItem>}
        {partners.map(p => (
          <SelectItem key={p.id} value={String(p.id)}>
            <PartnerDot color={p.color} /> {p.name}
          </SelectItem>
        ))}
        {includeShared && (
          <SelectItem value={SHARED_VALUE}>
            <PartnerDot color={SHARED.color} /> Shared (split evenly)
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}
