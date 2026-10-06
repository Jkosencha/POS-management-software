import React from 'react'
import { cn } from 'cn'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

/*
 * Thin wrapper over the shadcn Dialog. Callers mount it conditionally
 * ({open && <Modal ... />}), so it is always open while rendered and
 * closing (Esc, overlay click, X button) just calls onClose.
 */
export default function Modal({ title, description, children, onClose, className }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className={cn('max-w-[440px]', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description
            ? <DialogDescription>{description}</DialogDescription>
            : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        <div className="min-w-0">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
