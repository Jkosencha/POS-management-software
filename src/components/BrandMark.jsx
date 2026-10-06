import React from 'react'
import { ShoppingBag } from 'lucide-react'
import { cn } from 'cn'

// Purple rounded tile with a shopping bag: matches the PWA / home-screen icon
export default function BrandMark({ className, iconSize = 18 }) {
  return (
    <div className={cn('size-9 shrink-0 rounded-[11px] grid place-items-center text-white shadow-sm bg-linear-to-br from-[#8f80f8] to-[#6a59e4]', className)}>
      <ShoppingBag size={iconSize} strokeWidth={2.4} />
    </div>
  )
}
