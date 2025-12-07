import { ThemeToggle } from './ui/theme-toggle.tsx'

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur px-4 py-4">
      <div className="container mx-auto flex items-center justify-between">
        <div></div>
        <ThemeToggle />
      </div>
    </header>
  )
}
