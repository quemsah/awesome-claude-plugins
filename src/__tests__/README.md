# Test Suite Documentation

This directory contains comprehensive unit tests for the Awesome Claude Plugins project.

## Setup

The test suite uses:
- **Vitest** - Fast, modern test runner with native ESM support
- **React Testing Library** - Testing utilities for React components
- **jsdom** - DOM implementation for Node.js
- **@testing-library/jest-dom** - Custom matchers for DOM assertions

## Running Tests

```bash
# Run tests in watch mode (default)
npm test

# Run tests once
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

## Test Structure

### Hooks Tests (`src/__tests__/hooks/`)

#### `useInstallCommand.test.ts`
Tests for the install command generation hook:
- Command generation with various plugin name formats
- Clipboard copying functionality
- Timer-based state management (isCopied)
- Edge cases: special characters, unicode, empty values

#### `useRepo.test.ts`
Tests for the repository data fetching hook:
- Successful repository data fetching
- Error handling (404, network errors, JSON parsing)
- Dependency change behavior
- Edge cases: malformed paths, special characters

#### `usePlugins.test.ts`
Tests for the plugin data fetching hook:
- Plugin data fetching from marketplace.json
- Handling different JSON structures (array vs object)
- Error handling and 404 responses
- Null repo handling
- Dependency change behavior

### Component Tests (`src/__tests__/components/`)

#### Plugin Components (`repo/`)

**`PluginAuthor.test.tsx`**
- Rendering author name and email
- Conditional rendering based on available data
- Styling and accessibility
- Edge cases: long names, special characters

**`PluginDescription.test.tsx`**
- Description text rendering
- Conditional rendering
- Styling with hover effects
- Edge cases: HTML characters, unicode, markdown syntax

**`PluginHeader.test.tsx`**
- Plugin name with version rendering
- Category badge rendering
- Default "Unnamed Plugin" fallback
- Styling and transitions

**`PluginId.test.tsx`**
- Plugin ID display
- Conditional rendering
- Break-all styling for long IDs
- Edge cases: URLs, special formats

**`PluginKeywords.test.tsx`**
- Multiple keyword badges rendering
- Handling duplicate keywords
- Conditional rendering
- Key generation for stable rendering

**`PluginSource.test.tsx`**
- Source file link generation
- GitHub URL construction
- Link attributes (target, rel)
- Branch handling

**`PluginList.test.tsx`**
- List of files/commands/agents rendering
- Item count display in title
- GitHub blob URL generation
- List styling and accessibility

**`InstallCommand.test.tsx`**
- Install command generation
- Copy to clipboard functionality
- Visual feedback (copied state)
- Accessibility attributes

#### Common Components (`common/`)

**`Google.test.tsx`**
- GoogleAnalytics and GoogleTagManager rendering
- Conditional rendering based on environment
- Analytics enabled/disabled states
- Export verification

### Library Tests (`src/__tests__/lib/`)

#### `analytics.test.ts`
- Environment variable handling (GA_ID, GTM_ID)
- Analytics enabled logic in different environments
- Edge cases: empty strings, undefined values

## Test Patterns

### Mocking

```typescript
// Mocking navigator.clipboard
vi.spyOn(navigator.clipboard, 'writeText')

// Mocking fetch
global.fetch = vi.fn()

// Mocking timers
vi.useFakeTimers()
vi.advanceTimersByTime(500)
```

### Testing Hooks

```typescript
const { result } = renderHook(() => useCustomHook(params))
expect(result.current.value).toBe(expected)
```

### Testing Components

```typescript
render(<Component prop="value" />)
expect(screen.getByText('text')).toBeInTheDocument()
```

### Async Testing

```typescript
await waitFor(() => {
  expect(screen.getByText('loaded')).toBeInTheDocument()
})
```

## Coverage Goals

The test suite aims for:
- **Statements**: >90%
- **Branches**: >85%
- **Functions**: >90%
- **Lines**: >90%

## Best Practices

1. **Arrange-Act-Assert**: Structure tests clearly
2. **Descriptive Names**: Use clear test descriptions
3. **Edge Cases**: Test boundary conditions
4. **Error Handling**: Test failure scenarios
5. **Accessibility**: Verify ARIA attributes and semantic HTML
6. **Cleanup**: Use proper setup/teardown
7. **Isolation**: Each test should be independent

## Common Issues

### Timer-based Tests
Always use `vi.useFakeTimers()` and clean up with `vi.useRealTimers()`

### Async Operations
Use `waitFor` for async state updates, not arbitrary delays

### Component Rendering
Clean up after each test with `cleanup()` (configured in setup)

## Adding New Tests

1. Create test file next to the component/hook or in `__tests__` directory
2. Follow existing naming convention: `*.test.ts` or `*.test.tsx`
3. Import necessary utilities from testing library
4. Group related tests with `describe` blocks
5. Write comprehensive edge case tests
6. Ensure tests are deterministic and isolated

## Continuous Integration

Tests run automatically on:
- Pull requests
- Main branch commits
- Pre-commit hooks (via husky)

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Testing Library Queries](https://testing-library.com/docs/queries/about)
- [Jest DOM Matchers](https://github.com/testing-library/jest-dom)