'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

const INTERNAL_URL_ORIGIN = 'https://internal.invalid'
const UNSAFE_INTERNAL_URL_CHARACTERS = /[\u0000-\u001f\u007f\\]/

export function resolveSafeInternalUrl(storedUrl: string | null | undefined): string {
  // URL parsers can turn backslashes and control characters into an external authority.
  // Check the parsed origin instead of trusting a raw string prefix.
  if (typeof storedUrl !== 'string' || !storedUrl.startsWith('/') || UNSAFE_INTERNAL_URL_CHARACTERS.test(storedUrl)) {
    return '/'
  }

  try {
    const parsed = new URL(storedUrl, INTERNAL_URL_ORIGIN)
    if (parsed.origin !== INTERNAL_URL_ORIGIN) return '/'
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return '/'
  }
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
