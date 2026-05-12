// jest.setup.js - Jest configuration and global test setup

require('@testing-library/jest-dom')

// Dummy env vars so server-side config modules can be imported without throwing.
// Integration tests that need a real database use RUN_INTEGRATION_TESTS=1 to opt in
// and are skipped (describe.skip) when that var is absent.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://dummy.supabase.co'
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon-key'
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key'
if (!process.env.JWT_SECRET_KEY) process.env.JWT_SECRET_KEY = 'dummy-jwt-secret-key-at-least-32-chars!!'
if (!process.env.AUTH_ALLOWED_DOMAINS) process.env.AUTH_ALLOWED_DOMAINS = 'nxtwave.co.in'
if (!process.env.NEXT_PUBLIC_SITE_URL) process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'

jest.mock('canvas-confetti', () => jest.fn())

jest.mock('@/core/infra/logging/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Mock Supabase client for tests
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null }),
      upsert: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
    })),
    auth: {
      signOut: jest.fn().mockResolvedValue({}),
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      exchangeCodeForSession: jest.fn().mockResolvedValue({ data: { session: {} } }),
    },
  })),
}))

// Mock next/headers
jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}))

// Suppress console logs in tests (optional)
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  time: jest.fn(),
  timeEnd: jest.fn(),
}
