import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Setup mock server for Node.js environment (Jest tests)
export const server = setupServer(...handlers)