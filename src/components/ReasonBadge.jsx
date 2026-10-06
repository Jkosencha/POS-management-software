import React from 'react'
import { Badge } from '@/components/ui/badge'

const VARIANT = {
  sale:       'secondary',
  restock:    'success',
  return:     'success',
  adjustment: 'warning',
  spoilage:   'destructive',
}

// Stock movement reason pill, shared by stock history and reports
export default function ReasonBadge({ reason }) {
  return <Badge variant={VARIANT[reason] || 'outline'} className="capitalize">{reason}</Badge>
}
