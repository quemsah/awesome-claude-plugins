'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export function resolveSafeInternalUrl(storedUrl: string | null | undefined): string {
  if (typeof storedUrl === 'string' && storedUrl.startsWith('/') && !storedUrl.startsWith('//') && !storedUrl.startsWith('/\\')) {
    return storedUrl
  }
  return '/'
}

export function BackToRepositoriesLink({ className = '' }: { className?: string }) {
  const [href, setHref] = useState('/')

  useEffect(() => {
    try {
      const storedSearchUrl = window.sessionStorage.getItem('last-search-url')
      const safeUrl = resolveSafeInternalUrl(storedSearchUrl)
      if (safeUrl !== '/') {
        setHref(safeUrl)
      }
    } catch {
      // Ignore sessionStorage access errors
    }
  }, [])

  return (
    <Link aria-label="Back to all repositories" className={className} href={href}>
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Back to all repositories
    </Link>
  )
}
