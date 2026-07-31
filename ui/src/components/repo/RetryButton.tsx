'use client'

import { useRouter } from 'next/navigation'
import { Button } from '../ui/button.tsx'

export function RetryButton() {
  const router = useRouter()

  return (
    <Button onClick={() => router.refresh()} size="sm" type="button">
      Retry
    </Button>
  )
}
