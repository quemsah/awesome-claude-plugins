import { ThemeToggle } from './ui/theme-toggle.tsx'

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur">
      <div className="flex items-center justify-between px-4 py-4">
        <h1 className="text-xl font-bold text-foreground">awesome-claude-plugins</h1>
        <ThemeToggle />
      </div>
    </header>
  )
}
