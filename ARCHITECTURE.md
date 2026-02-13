# NXT Legal - Enterprise Architecture Refactor

## Overview

This document describes the refactored architecture of NXT Legal, designed for:
- **Zero hardcoding** (routes, domains, roles, feature flags all config-driven)
- **Horizontal scalability** (stateless, service-oriented)
- **Clean separation of concerns** (domain → service → repository → infra)
- **Future microservices readiness** (pluggable adapters, clear boundaries)
- **Production-grade patterns** (error handling, validation, logging, response envelopes)

---

## Folder Structure

```
src/
├── core/                      # Shared infrastructure & domain
│   ├── config/                # Configuration (env, routes, features)
│   │   ├── app-config.ts      # Server config (aggregator)
│   │   ├── public-config.ts   # Client-safe config
│   │   ├── env.server.ts      # Server-only env validation
│   │   ├── env.public.ts      # Public env values
│   │   ├── route-registry.ts  # All app routes (centralized)
│   │   ├── feature-flags.ts   # Feature flags (env-driven)
│   │   └── [other configs]
│   │
│   ├── constants/             # Type-safe constants & error codes
│   │   ├── auth-errors.ts     # Auth error codes & messages
│   │   ├── cookies.ts         # Cookie names
│   │   ├── limits.ts          # Length/size limits
│   │   └── [more constants]
│   │
│   ├── registry/              # Dynamic registries (roles, permissions)
│   │   ├── roles.ts           # Role definitions
│   │   └── permissions.ts     # Permission definitions
│   │
│   ├── http/                  # HTTP response & request handling
│   │   └── response.ts        # Standard response envelope
│   │
│   ├── infra/                 # Low-level infrastructure adapters
│   │   ├── session/
│   │   │   └── jwt-session-store.ts     # JWT session (pluggable)
│   │   ├── auth/
│   │   │   └── supabase-oauth-client.ts # OAuth adapter (Supabase)
│   │   ├── repositories/
│   │   │   └── supabase-employee-repository.ts  # DB adapter
│   │   └── logging/
│   │       └── logger.ts      # Logging abstraction (pluggable)
│   │
│   ├── domain/                # Business logic (DDD)
│   │   ├── auth/
│   │   │   ├── auth-service.ts        # Auth orchestration (password + OAuth)
│   │   │   ├── types.ts               # Auth domain types
│   │   │   ├── policies/
│   │   │   │   └── domain-policy.ts   # Domain validation logic
│   │   │   └── guards/
│   │   │       └── route-guard.ts     # Protected route accessor
│   │   └── users/
│   │       └── employee-repository.ts # Repository interface (abstract)
│   │
│   ├── client/                # Client-side API clients (safe to expose)
│   │   ├── api-client.ts      # Generic HTTP client
│   │   └── auth-client.ts     # Auth API endpoints
│   │
│   └── presenters/            # Data presenters for views
│       └── auth-presenter.ts  # Auth view data
│
├── modules/                   # Feature modules
│   └── auth/
│       └── ui/                # Hooks & client components
│           ├── use-login-page.ts       # Login page logic
│           └── use-employee-login.ts   # Employee login form logic
│
├── components/                # UI components (mostly dumb)
│   └── auth/
│       ├── MicrosoftButton.tsx
│       ├── EmployeeLoginForm.tsx
│       └── LogoutButton.tsx
│
└── app/                       # Next.js App Router
    ├── layout.tsx             # Root layout
    ├── login/
    │   └── page.tsx           # Login page (client)
    ├── (protected)/
    │   ├── layout.tsx         # Protected routes guard
    │   └── dashboard/
    │       └── page.tsx       # Dashboard (protected)
    ├── auth/
    │   └── callback/
    │       └── route.ts       # OAuth callback handler
    └── api/
        └── auth/
            ├── login/
            │   └── route.ts   # Password login endpoint
            ├── logout/
            │   └── route.ts   # Logout endpoint
            └── session/
                └── route.ts   # Session check endpoint
```

---

## Data Flow Diagrams

### Password Login Flow

```
EmployeeLoginForm (client)
  ↓ (calls)
useEmployeeLogin hook
  ↓ (calls)
authClient.login() → POST /api/auth/login
  ↓ (server route handler)
/api/auth/login
  ↓ (calls)
authService.loginWithPassword()
  ↓ (validates input, sanitizes employeeId)
supabaseEmployeeRepository.findByEmployeeId()
  ↓ (loads from DB, handles errors gracefully)
Database lookup + password verify
  ↓ (on success)
createSession() → JWT cookie set
  ↓ (response)
{ ok: true, data: { employee: {...} } }
  ↓ (client validates response envelope)
useEmployeeLogin validates response.data
  ↓ (redirect)
router.push('/dashboard')
```

### OAuth Flow

```
MicrosoftButton (client)
  ↓ (calls)
startMicrosoftOAuth()
  ↓ (redirects to Supabase OAuth)
Supabase OAuth flow → Azure AD → Callback
  ↓ (receives auth code)
GET /auth/callback?code=XXX
  ↓ (server route handler)
/app/auth/callback
  ↓ (calls)
Supabase.auth.exchangeCodeForSession()
  ↓ (resolves email from user metadata/identities)
resolveUserEmail() → finds email/preferred_username/upn
  ↓ (calls)
authService.loginWithOAuth()
  ↓ (checks domain policy)
isAllowedDomain(email)
  ↓ (on success, performs employee lookup)
supabaseEmployeeRepository.findByEmail()
  ↓ (on success, creates session)
createSession() → JWT cookie set
  ↓ (redirect)
302 → /dashboard
```

### Protected Route Access

```
GET /dashboard
  ↓ (layout guard runs)
ProtectedLayout.requireAuthenticatedUser()
  ↓ (validates session)
getSession() → decodes JWT, validates employeeId
  ↓ (on success)
returns session → renders page
  ↓ (on failure, redirects)
redirect('/login')
```

---

## Configuration System

### Design Principles
- All config values read from env at startup
- Type-safe throughout (TypeScript validation)
- Clear server/public boundary (no secrets exposed to client)
- Fallbacks + validation ensure predictable runtime behavior
- Errors on startup (fail-fast) rather than runtime surprises

### Config Hierarchy

```
Environment Variables (.env.local)
         ↓
Server Config (env.server.ts)
         ↓
Client Config (env.public.ts)
         ↓
App Config (app-config.ts)     Public Config (public-config.ts)
         ↓                               ↓
Domain Services                   Client Components/Hooks
```

### Adding New Configuration

**Example: Add new allowed role**

1. Add to env:
   ```
   NEXT_PUBLIC_FEATURE_ADMIN_UI=true
   ```

2. Update `env.public.ts`:
   ```typescript
   export const envPublic = {
     ...
     featureAdminUi: process.env.NEXT_PUBLIC_FEATURE_ADMIN_UI ?? ''
   }
   ```

3. Update `public-config.ts`:
   ```typescript
   export const publicConfig = {
     ...
     features: {
       ...
       enableAdminUI: envPublic.featureAdminUi.toLowerCase() !== 'false'
     }
   }
   ```

4. Use in component:
   ```typescript
   import { publicConfig } from '@/core/config/public-config'
   
   export function Dashboard() {
     return (
       <>
         {publicConfig.features.enableAdminUI && <AdminPanel />}
       </>
     )
   }
   ```

---

## Service & Repository Layers

### Auth Service Pattern

```typescript
// Domain service (business logic)
export const authService = {
  async loginWithPassword(req) { /* orchestrates password flow */ },
  async loginWithOAuth(profile) { /* orchestrates OAuth flow */ },
  async logout() { /* clears session */ },
  async getSession() { /* retrieves current session */ },
}
```

**Benefits:**
- Centralizes auth logic (single source of truth)
- Mockable for testing
- Replaceable (can add LDAP, SAML, etc. without changing routes)
- Validates business rules (domain allowlist, active status, etc.)

### Repository Pattern

```typescript
// Abstract interface (contract)
export interface EmployeeRepository {
  findByEmployeeId(lookup): Promise<EmployeeRecord | null>
  findByEmail(lookup): Promise<EmployeeRecord | null>
}

// Concrete implementation (Supabase)
export const supabaseEmployeeRepository: EmployeeRepository = {
  async findByEmployeeId(lookup) { /* Supabase query */ },
  async findByEmail(lookup) { /* Supabase query */ },
}
```

**Benefits:**
- Swappable database (Supabase → PostgreSQL → MongoDB later)
- Error handling centralized (graceful Supabase error handling)
- Query logic isolated from business logic
- Easy to test (mock repository)

### Adapter Pattern (OAuth)

```typescript
// Abstraction: "start OAuth"
export const startMicrosoftOAuth = async () => {
  const supabase = createClient()
  const provider = publicConfig.auth.oauthProvider // config-driven!
  await supabase.auth.signInWithOAuth({ provider, ...opts })
}

// Can be replaced later:
// export const startOAuth = async () => {
//   const auth0 = new Auth0Client()
//   await auth0.loginWithRedirect({ ...opts })
// }
```

**Benefits:**
- Provider is config-driven (no code change to switch providers)
- Easy to add new providers
- Clear separation from route handler

---

## Error Handling & Response Envelopes

### Standard Response Envelope

```typescript
type ApiResponse<T> = {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

// Success
{ ok: true, data: { employee: {...} } }

// Error
{ ok: false, error: { code: "invalid_credentials", message: "Invalid Employee ID or Password" } }
```

**Benefits:**
- Consistent across all endpoints
- Client can check `response.ok` reliably
- Type-safe error handling
- Error codes enable i18n/localization

### Error Code Registry

```typescript
// All error codes centralized (no magic strings)
export const authErrorCodes = {
  oauthFailed: 'oauth_failed',
  noCode: 'no_code',
  unauthorized: 'unauthorized',
  authFailed: 'auth_failed',
  invalidCredentials: 'invalid_credentials',
  accountInactive: 'account_inactive',
}

// All messages mapped
export const authErrorMessages: Record<AuthErrorCode, string> = {
  [authErrorCodes.invalidCredentials]: 'Invalid Employee ID or Password',
  ...
}
```

---

## Logging & Diagnostics

### Logger Abstraction

```typescript
export const logger: Logger = {
  info: (message, context?) => console.info(...),
  warn: (message, context?) => console.warn(...),
  error: (message, context?) => console.error(...),
}

// Usage
logger.error('Employee lookup failed', { email, error: err.message })
```

**Replaceable:** Can swap console with:
- External service (Sentry, LogRocket)
- Structured logging (Winston, Pino)
- Custom aggregator

### Strategic Logging Points

- **Session creation/validation failures** (auth issues)
- **Database errors** (data access problems)
- **Route access denials** (security events)
- **Config loading** (startup validation)

---

## Scalability & 10x Growth

### Design for Horizontal Scaling

1. **Stateless Services**
   - Auth service doesn't hold state
   - Session stored in JWT (in cookie), not memory
   - Can run multiple app instances behind load balancer

2. **Pluggable Databases**
   - Repository pattern allows swapping Supabase for PostgreSQL cluster
   - Can add caching layer (Redis) later

3. **Service Isolation**
   - Can extract auth service → separate microservice
   - OAuth adapter → auth gateway
   - Repository → data access microservice

4. **Feature Flags**
   - Roll out new auth methods (LDAP, SAML) without downtime
   - A/B test new flows
   - Kill switches for rollback

### Monitor & Scale

**Metrics to track:**
- Auth success/failure rates
- Session lookup time (should be <100ms)
- Database query latency
- Feature flag adoption

**Scaling strategy:**
1. Vertical: Add CPU/memory to single instance
2. Horizontal: Load balancer + N app instances + shared Supabase
3. Microservices: Extract auth service to separate container
4. Cache: Add Redis for session/employee lookups
5. CDN: Cache static assets + API responses where safe

---

## Future Changes: Zero Core Changes Required

### Adding New OAuth Provider (e.g., Google)

```typescript
// No core changes needed:
// 1. Add to config:
NEXT_PUBLIC_AUTH_OAUTH_PROVIDER=google

// 2. Update Supabase → enable provider
// 3. Done! Flow reuses existing abstractions
```

### Adding Password-less Magic Links

```typescript
// New flow:
export const authService = {
  async sendMagicLink(email: string) {
    // Validate domain
    if (!isAllowedDomain(email)) throw unauthorized
    // Send link (via email service)
    // Return success
  }
  async loginWithMagicLink(token: string) {
    // Verify token
    // Look up employee
    // Create session
  }
}

// Route just adds endpoints - no existing code changes
```

### Adding Roles & Permissions

```typescript
// Extend employee repo:
export interface EmployeeRepository {
  findByEmployeeId(lookup): Promise<EmployeeRecord>
  findByEmailWithRoles(lookup): Promise<EmployeeWithRoles>
}

// New policy:
export const canAccessDocuments = (employee: EmployeeWithRoles): boolean => {
  return employee.permissions.includes('view:documents')
}

// Route guard extends:
requireAuthenticatedUser()
requirePermission('view:documents')
```

---

## Environment-Specific Configs

### Local Development
```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
AUTH_ALLOWED_DOMAINS=test.local
JWT_SECRET_KEY=dev-secret-min-32-chars-long-for-local-testing
FEATURE_MICROSOFT_OAUTH=false  # Skip OAuth in dev
FEATURE_PASSWORD_LOGIN=true
```

### Staging
```env
NEXT_PUBLIC_SITE_URL=https://staging.nxtlegal.com
AUTH_ALLOWED_DOMAINS=nxtwave-staging.onmicrosoft.com
JWT_SECRET_KEY=(strong random 32+ chars)
FEATURE_MICROSOFT_OAUTH=true
FEATURE_PASSWORD_LOGIN=true
```

### Production
```env
NEXT_PUBLIC_SITE_URL=https://nxtlegal.com
AUTH_ALLOWED_DOMAINS=nxtwave.co.in
JWT_SECRET_KEY=(strong random 32+ chars, rotated quarterly)
FEATURE_MICROSOFT_OAUTH=true
FEATURE_PASSWORD_LOGIN=true (or false if OAuth-only)
```

---

## Testing Strategy

### Unit Tests

```typescript
// auth-service.ts
describe('authService', () => {
  it('rejects unauthorized domains', async () => {
    const mockRepo = { findByEmail: () => null }
    const result = authService.loginWithOAuth({ email: 'attacker@evil.com' })
    expect(result).toThrow('unauthorized')
  })
})
```

### Integration Tests

```typescript
// E2E login flow
describe('OAuth flow', () => {
  it('exchanges code for session', async () => {
    // Mock Supabase exchange
    // Call /auth/callback
    // Verify session cookie set
    // Verify redirect to /dashboard
  })
})
```

### Mock Strategies
- Mock `supabaseEmployeeRepository` for service tests
- Mock `createClient()` for OAuth tests
- Mock session store for guard tests

---

## Deployment Checklist

- [ ] All env vars set in production (secrets manager)
- [ ] JWT_SECRET_KEY is strong (32+ chars, random, rotated)
- [ ] Supabase RLS policies reviewed for production
- [ ] OAuth provider configured (Azure redirect URIs)
- [ ] Logging/monitoring endpoints configured
- [ ] HTTPS enforced (secure cookies in prod)
- [ ] Session timeout appropriate for security
- [ ] Feature flags configured for production
- [ ] Database backups enabled
- [ ] Load tested under expected QPS

---

## Support & Evolution

For adding new features:
1. Check if existing patterns apply (service, repository, adapter)
2. Follow DDD principles (isolate domain logic)
3. Use config/registry for new constants
4. Add logging at strategy points
5. Update this doc for significant changes
6. See [DIAGNOSTICS.md](DIAGNOSTICS.md) for troubleshooting
