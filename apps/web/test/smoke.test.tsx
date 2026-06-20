import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'

// Proves the web test runner works with jsdom + React rendering. Real component
// and page tests arrive alongside features in later phases.
describe('web smoke', () => {
  it('renders a button', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined()
  })
})
