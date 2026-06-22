import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees between tests so repeated renders don't accumulate in jsdom.
afterEach(cleanup)
