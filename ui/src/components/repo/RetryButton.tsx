'use client'

import { useRouter } from 'next/navigation'
import { Button } from '../ui/button.tsx'

type RetryButtonProps = {
  onRetry?: () => void
}

export function RetryButton({ onRetry }: RetryButtonProps) {
  const router = useRouter()

  return (
    <Button onClick={onRetry ?? (() => router.refresh())} size="sm" type="button">
      Retry
    </Button>
  )
}
