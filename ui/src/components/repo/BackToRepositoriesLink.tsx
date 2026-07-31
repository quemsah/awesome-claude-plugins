'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export function BackToRepositoriesLink({ className = '' }: { className?: string }) {
  const [href, setHref] = useState('/')

  useEffect(() => {
    const storedSearchUrl = window.sessionStorage.getItem('last-search-url')
    if (storedSearchUrl?.startsWith('/')) {
      setHref(storedSearchUrl)
    }
  }, [])

  return (
    <Link aria-label="Back to all repositories" className={className} href={href}>
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Back to all repositories
    </Link>
  )
}
