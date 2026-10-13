import { describe, expect, it } from 'vitest'
import AboutPage from './page.tsx'

describe('AboutPage', () => {
  it('renders the about page root element', () => {
    const element = AboutPage()
    expect(element).toBeDefined()
    expect(element.type).toBe('main')
    expect(element.props.id).toBe('main-content')
  })
})
