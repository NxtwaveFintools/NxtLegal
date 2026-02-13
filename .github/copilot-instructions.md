# Copilot Instructions for NXT Legal

This document provides comprehensive guidelines for AI-assisted development on the NXT Legal CLM system. All code changes, feature implementations, and architectural decisions should follow these rules.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Architecture Principles](#architecture-principles)
4. [Configuration & Constants Discipline](#configuration--constants-discipline)
5. [Multi-Tenant Isolation Rules](#multi-tenant-isolation-rules)
6. [Authentication & Security Rules](#authentication--security-rules)
7. [Domain Layer Purity Rules](#domain-layer-purity-rules)
8. [API Standards & Idempotency](#api-standards--idempotency)
9. [Input Validation & Error Handling](#input-validation--error-handling)
10. [Rate Limiting & Security Hardening](#rate-limiting--security-hardening)
11. [Background Jobs Architecture](#background-jobs-architecture)
12. [Database Discipline](#database-discipline)
13. [Observability & Monitoring](#observability--monitoring)
14. [Feature Module Boundaries](#feature-module-boundaries)
15. [Data Residency Strategy](#data-residency-strategy)
16. [MCP Usage Guidelines](#mcp-usage-guidelines)
17. [Code Quality Standards](#code-quality-standards)
18. [Performance Guidelines](#performance-guidelines)
19. [Logging Requirements](#logging-requirements)
20. [Testing Requirements](#testing-requirements)
21. [Edge Case Discipline](#edge-case-discipline)
22. [Common Patterns](#common-patterns)
23. [Forbidden Patterns](#forbidden-patterns)
24. [Quick Reference](#quick-reference)

---

## Project Overview

**Project Name:** NXT Legal - Contract Lifecycle Management (CLM) System  
**Purpose:** Enterprise-grade legal document and contract management platform  
**Target Users:** Legal professionals, contract managers, legal executives  
**Deployment Context:** Cloud-based SaaS with multi-tenant foundations

### Key Constraints

- **Session Duration:** 2 days (short-lived by enterprise standards; requires robust refresh token strategy)
- **Scale:** Enterprise customers with millions of documents/contracts
- **Compliance:** Financial services, legal industry regulations (e.g., SOX, data residency)
- **Architecture Philosophy:** Scalable, modular, reusable components; proxy pattern (NOT middleware)

---

## Technology Stack

### Frontend
- **Framework:** Next.js 16 (App Router, React Server Components)
- **Language:** TypeScript (strict mode enabled)
- **Styling:** CSS Modules + Tailwind CSS
- **State Management:** React hooks + server state via API
- **HTTP Client:** Custom API client with interceptors (exponential backoff, auto-refresh)

### Backend
- **Runtime:** Node.js (Next.js API Routes)
- **Database:** PostgreSQL (via Supabase)
- **Authentication:** OAuth 2.0 (Microsoft AD) + Email/Password (JWT-based)
- **Session Storage:** JWT tokens (dual-token strategy: 2-day access + 7-day refresh)
- **Authorization:** Row-Level Security (RLS) policies in PostgreSQL

### Infrastructure & DevOps
- **Hosting:** Vercel (Next.js optimized)
- **Authentication Provider:** Supabase (managed PostgreSQL + auth)
- **Secrets Management:** Environment variables (server-side only for sensitive data)
- **Monitoring & Logging:** Structured JSON logging (environment-aware: DEBUG in dev, WARN+ in prod)

### Developer Experience
- **Linting:** ESLint (preset configurations)
- **Code Formatting:** Prettier (2-space tabs, 120 char line width, single quotes)
- **Pre-Commit Hooks:** Husky + lint-staged (automatic formatting + linting before commit)
- **Type Checking:** TypeScript compiler (tsc --noEmit in CI/CD)
- **AI Integration:** Model Context Protocol (MCP) servers for Supabase, Next.js, and Filesystem

---

## Architecture Principles

### Core Design Patterns

#### 1. **Proxy Pattern (NOT Middleware)**
- **Use case:** API route protection, request/response transformation
- **Implementation:** Higher-Order Functions (HOFs) like `withAuth()` and `withOptionalAuth()`
- **File location:** `src/core/http/with-auth.ts`
- **Why NOT middleware:** Explicit per-route protection is more testable and maintainable than global middleware that processes every request

```typescript
// Correct: Proxy pattern using HOF
import { withAuth } from '@/core/http/with-auth';

export const GET = withAuth(async (req, session) => {
  // Route handler with guaranteed authenticated session
  return Response.json({ user: session.user });
});

// Incorrect: Middleware approach (forbidden)
// Global middleware that processes every request indiscriminately
```

#### 2. **Modular Service Layer**
- Repository pattern for data access
- Domain services for business logic (+ guards for authorization)
- Presenters for response formatting
- **Benefit:** Easy to test, swap implementations, prevent tight coupling

#### 3. **Type-Safe Configuration**
- Centralized config in `src/core/config/`
- Environment variables validated at build time
- **No string-based config keys** - use typed objects with TypeScript

#### 4. **Error-First Responses**
- All API responses include clear error context (error codes, messages, field-level validation)
- Structured error objects with retry flags and error types
- Client-side interceptor handles retryable errors automatically

---

## Configuration & Constants Discipline

### Zero Hardcoding Rule (Mandatory)

All configuration values, routes, feature flags, token durations, cookie names, roles, statuses, and magic numbers **must** be defined in centralized config or constants files. Hardcoded string values scattered across files are **forbidden**.

### Required Configuration Files

**`src/core/constants/`** - For rarely-changing values:
```typescript
// src/core/constants/limits.ts
export const limits = {
  sessionDays: 2,
  refreshTokenDays: 7,
  maxLoginAttempts: 5,
  requestTimeoutMs: 30000,
  paginationPageSize: 50,
  maxFileUploadMb: 100,
};

// src/core/constants/roles.ts
export const ROLES = {
  ADMIN: 'admin',
  LEGAL_COUNSEL: 'legal_counsel',
  CONTRACT_MANAGER: 'contract_manager',
  VIEWER: 'viewer',
} as const;

// src/core/constants/status.ts
export const CONTRACT_STATUS = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  EXECUTED: 'executed',
  EXPIRED: 'expired',
} as const;
```

**`src/core/config/`** - For environment-dependent values:
```typescript
// src/core/config/route-registry.ts
export const routes = {
  auth: {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    refresh: '/api/auth/refresh',
  },
  contracts: {
    list: '/api/contracts',
    detail: (id: string) => `/api/contracts/${id}`,
    upload: '/api/contracts/upload',
  },
} as const;

// src/core/config/feature-flags.ts
export const featureFlags = {
  enableAuditLogging: process.env.FEATURE_AUDIT_LOGGING === 'true',
  enableAdvancedTemplates: process.env.FEATURE_TEMPLATES === 'true',
};
```

### Enforcement Rules

✅ **REQUIRED:**
- All numeric limits defined in `limits.ts`
- All role/status enums in their own `constants/` files
- All routes collected in `route-registry.ts`
- Feature flags in `feature-flags.ts`
- API endpoints referenced via route config, never hardcoded

❌ **FORBIDDEN:**
```typescript
// ❌ Hardcoded everywhere
const response = await fetch('/api/contracts'); // Magic string!
if (userRole === 'admin') { } // Magic string!
const PAGE_SIZE = 50; // Should be in constants/limits.ts
```

✅ **CORRECT:**
```typescript
// All values from config/constants
import { routes } from '@/core/config/route-registry';
import { ROLES } from '@/core/constants/roles';
import { limits } from '@/core/constants/limits';

const response = await fetch(routes.contracts.list);
if (userRole === ROLES.ADMIN) { }
const PAGE_SIZE = limits.paginationPageSize;
```

### Pre-Commit Validation

Before committing, ensure:
- No hardcoded route strings (use `route-registry.ts`)
- No hardcoded role/status strings (use `constants/`)
- No magic numbers outside `limits.ts`
- All feature flags in `feature-flags.ts`

---

## Multi-Tenant Isolation Rules

### Tenant Scoping (Mandatory)

Since NXT Legal is SaaS with multi-tenant foundations, all data queries **must include tenant scoping**. Tenant isolation must be enforced at the RLS (Row-Level Security) level.

### Tenant ID Resolution

```typescript
// ✅ Get tenant from authenticated user
import { requireUser } from '@/lib/auth/require-user';

export const GET = withAuth(async (req, session) => {
  const tenantId = session.user.tenantId; // From JWT payload
  // All queries below scoped to this tenant
});
```

### Query Rules

**Rule 1: Always scope to tenant**
```typescript
// ❌ FORBIDDEN - Queries without tenant scoping
const contracts = await supabase
  .from('contracts')
  .select('*')
  .eq('status', 'active');

// ✅ CORRECT - All queries scoped by tenant_id
const contracts = await supabase
  .from('contracts')
  .select('*')
  .eq('status', 'active')
  .eq('tenant_id', tenantId); // ← ALWAYS include tenant filter
```

**Rule 2: Enforce at RLS level**

All tables with multi-tenant data must have RLS policies:

```sql
-- Example RLS policy (in Supabase migrations)
CREATE POLICY "contracts_tenant_isolation" ON contracts
FOR ALL
USING (tenant_id = auth.jwt()->>'tenant_id')
WITH CHECK (tenant_id = auth.jwt()->>'tenant_id');
```

**Rule 3: No cross-tenant queries allowed**

```typescript
// ❌ FORBIDDEN - Could leak data across tenants
const allContracts = await supabase
  .from('contracts')
  .select('*, employees(name, email)');
// This violates RLS and exposes other tenants' data!

// ✅ CORRECT - Tenant explicitly filtered
const contracts = await supabase
  .from('contracts')
  .select('*, employees(name, email)')
  .eq('tenant_id', session.user.tenantId);
```

### Tenant-Aware Patterns

**Service Layer**
```typescript
// ✅ Services always receive tenantId
export class ContractRepository {
  async listByTenant(tenantId: string, status: string) {
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', status);
    if (error) throw error;
    return data;
  }
}
```

**API Routes**
```typescript
// ✅ Extract tenant from session, pass to service
export const GET = withAuth(async (req, session) => {
  const tenantId = session.user.tenantId;
  const contracts = await contractRepository.listByTenant(tenantId, 'active');
  return successResponse(res, contracts, 200);
});
```

### Security Audit Checklist

- [ ] All data tables have `tenant_id` column
- [ ] All tables have RLS policies enforcing tenant isolation
- [ ] All API queries include `.eq('tenant_id', tenantId)`
- [ ] Services accept `tenantId` parameter
- [ ] No cross-tenant leakage possible (audit migrations)

---

## Authentication & Security Rules

### Token Strategy

#### Dual-Token JWT System
- **Access Token:** 2 days (short-lived, used for API requests)
- **Refresh Token:** 7 days (long-lived, stored in httpOnly cookie)
- **Storage:**
  - Access token: Memory (cleared on logout)
  - Refresh token: httpOnly, Secure, SameSite=Lax cookie (allows OAuth redirects)
- **Refresh Flow:** When access token expires (401 response), client automatically fetches new token via `POST /api/auth/refresh`

**Implementation Details:**
- File: `src/core/infra/session/jwt-session-store.ts`
- Endpoint: `src/app/api/auth/refresh/route.ts`
- Client interceptor: `src/core/client/api-client.ts` (auto-refresh on 401)

```typescript
// Token structure in JWT payload
interface JWTPayload {
  sub: string;           // User ID
  email: string;
  type: 'access' | 'refresh';  // Token type (MUST validate)
  exp: number;           // Expiration timestamp
  iat: number;           // Issued at
}
```

### Authentication Methods

1. **Microsoft OAuth (Recommended)**
   - Leverages existing Active Directory infrastructure
   - File: `src/infra/auth/supabase-oauth-client.ts`
   - Route: `src/app/auth/callback/route.ts`

2. **Email/Password (Fallback)**
   - File: `src/components/auth/EmployeeLoginForm.tsx`
   - Endpoint: `POST /api/auth/login`
   - Passwords: Hashed with bcrypt (via `src/lib/auth/password.ts`)

### Security Headers

All responses include security headers via `next.config.ts`:

| Header | Value | Purpose |
|--------|-------|---------|
| Content-Security-Policy | Strict (script-src 'self') | Prevent XSS attacks |
| Strict-Transport-Security | max-age=31536000 | Force HTTPS |
| X-Frame-Options | DENY | Prevent clickjacking |
| X-Content-Type-Options | nosniff | Prevent MIME-type sniffing |
| X-XSS-Protection | 1; mode=block | Legacy XSS protection |
| Referrer-Policy | strict-origin-when-cross-origin | Control referrer info |
| Permissions-Policy | geolocation=(), microphone=() | Restrict browser features |

### Session Management

- **Session Storage:** JWT in cookies (httpOnly for refresh, memory for access)
- **Session Validation:** `src/lib/auth/require-user.ts` middleware for React Server Components
- **Cookie Names:** 
  - Access token: `accessToken` (session cookie)
  - Refresh token: `refreshToken` (httpOnly, 7-day expiry)

### Authorization with RLS

- **Implementation:** PostgreSQL Row-Level Security policies (defined in migrations)
- **Policy Enforcement:** All queries run as authenticated user (Supabase client sets `Authorization` header)
- **File:** `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`

**Rule:** Never bypass RLS. All database operations MUST go through Supabase client (not raw SQL).

---

## Domain Layer Purity Rules

### Domain Isolation (Critical)

The `core/domain` layer must remain **pure** — free from infrastructure dependencies. This ensures testability, portability, and architectural integrity.

**Forbidden Imports in `core/domain`:**
```typescript
// ❌ NEVER import these in domain layer
import { supabase } from '@/lib/supabase/client'; // Infrastructure!
import { createClient } from '@supabase/supabase-js'; // External SDK!
import { logger } from '@/core/infra/logging/logger'; // Infrastructure!
import { oauth } from '@/core/infra/auth/supabase-oauth-client'; // Infrastructure!
```

**Allowed Imports in `core/domain`:**
```typescript
// ✅ Only these are allowed
import type { Repository } from './repositories/types'; // Abstractions only
import { validateEmail } from '@/lib/utils/validators'; // Pure utilities
import { contractStatuses } from '@/core/constants/status'; // Constants
import type { ContractDTO } from './presenters/types'; // DTOs/Types
```

### Dependency Injection Rule

All infrastructure dependencies (database clients, HTTP clients, loggers, external SDKs) **must be injected** into domain services.

```typescript
// ❌ WRONG - Direct infrastructure coupling
export class ContractsService {
  async getContract(id: string) {
    const { data } = await supabase.from('contracts').select('*').eq('id', id);
    logger.info('Contract fetched', { id });
    return data;
  }
}

// ✅ CORRECT - Dependency injection
export class ContractsService {
  constructor(
    private contractRepository: IContractRepository,
    private logger: ILogger
  ) {}

  async getContract(id: string): Promise<Contract | null> {
    const contract = await this.contractRepository.findById(id);
    this.logger.info('Contract fetched', { id });
    return contract;
  }
}

// Infrastructure implementation (in core/infra/repositories/)
export class SupabaseContractRepository implements IContractRepository {
  constructor(private supabase: SupabaseClient) {}

  async findById(id: string): Promise<Contract | null> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }
}
```

### Repository Abstraction Pattern

**File Structure:**
```
core/
├── domain/
│   ├── contracts/
│   │   ├── contracts-service.ts       # Business logic (pure)
│   │   ├── types.ts                   # Domain types
│   │   └── repositories/
│   │       └── contract-repository.interface.ts  # Abstract interface
│   └── auth/
│       └── auth-service.ts
└── infra/
    └── repositories/
        ├── supabase-contract-repository.ts  # Concrete implementation
        └── supabase-employee-repository.ts
```

**Interface Definition (in `core/domain`):**
```typescript
// core/domain/contracts/repositories/contract-repository.interface.ts
export interface IContractRepository {
  findById(id: string): Promise<Contract | null>;
  findByTenant(tenantId: string, filters: ContractFilters): Promise<Contract[]>;
  create(contract: CreateContractDTO): Promise<Contract>;
  update(id: string, updates: Partial<Contract>): Promise<Contract>;
  softDelete(id: string): Promise<void>;
}
```

**Concrete Implementation (in `core/infra`):**
```typescript
// core/infra/repositories/supabase-contract-repository.ts
import type { IContractRepository } from '@/core/domain/contracts/repositories/contract-repository.interface';
import type { SupabaseClient } from '@supabase/supabase-js';

export class SupabaseContractRepository implements IContractRepository {
  constructor(private supabase: SupabaseClient) {}

  async findById(id: string): Promise<Contract | null> {
    // Supabase-specific implementation
  }
  // ... other methods
}
```

### Domain Layer Checklist

- [ ] No direct imports of `supabase`, `logger`, or external SDKs in `core/domain`
- [ ] All services use constructor injection for dependencies
- [ ] Repository interfaces defined in `core/domain`
- [ ] Concrete repository implementations in `core/infra`
- [ ] Domain services testable with mocked repositories

---

## API Standards & Idempotency

### Idempotency Support (Mandatory for POST)

All `POST` endpoints (creates, mutations) **must support idempotency** to prevent duplicate operations during retries.

**Implementation:**

1. **Client sends `Idempotency-Key` header:**
```typescript
// Client request
const response = await fetch('/api/contracts', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': 'uuid-v4-generated-by-client',
  },
  body: JSON.stringify({ name: 'NDA Agreement', ... }),
});
```

2. **Server checks for existing idempotency record:**
```typescript
// src/app/api/contracts/route.ts
export const POST = withAuth(async (req: NextRequest, session: Session) => {
  const idempotencyKey = req.headers.get('Idempotency-Key');
  
  if (!idempotencyKey) {
    return errorResponse(res, {
      code: 'MISSING_IDEMPOTENCY_KEY',
      statusCode: 400,
      message: 'Idempotency-Key header required for POST requests',
    });
  }

  // Check if this key was already processed (within 24 hours)
  const existing = await idempotencyService.get(idempotencyKey, session.user.tenantId);
  if (existing) {
    logger.info('Idempotent request detected, returning cached response', {
      idempotencyKey,
      userId: session.user.id,
    });
    return Response.json(existing.response, { status: existing.statusCode });
  }

  // Process request normally
  const contract = await contractsService.createContract(session.user.tenantId, requestData);

  // Store idempotency record (expires after 24 hours)
  await idempotencyService.set(
    idempotencyKey,
    session.user.tenantId,
    { data: contract },
    201
  );

  return successResponse(res, { contract }, 201);
});
```

3. **Idempotency service implementation:**
```typescript
// core/domain/idempotency/idempotency-service.ts
export class IdempotencyService {
  constructor(private repository: IIdempotencyRepository) {}

  async get(key: string, tenantId: string): Promise<IdempotencyRecord | null> {
    return await this.repository.findByKey(key, tenantId);
  }

  async set(
    key: string,
    tenantId: string,
    response: any,
    statusCode: number
  ): Promise<void> {
    await this.repository.create({
      key,
      tenant_id: tenantId,
      response,
      status_code: statusCode,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });
  }
}
```

**Database Schema:**
```sql
CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  response JSONB NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(key, tenant_id)
);

CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys(expires_at);
```

**Cleanup Job (scheduled):**
```typescript
// Delete expired idempotency records daily
DELETE FROM idempotency_keys WHERE expires_at < NOW();
```

### Idempotency Requirements

- [ ] All POST endpoints validate `Idempotency-Key` header
- [ ] Idempotency records stored for 24 hours
- [ ] Duplicate keys return original response (same status code)
- [ ] Idempotency scoped to tenant (prevents cross-tenant key collisions)
- [ ] Cleanup job scheduled to purge expired records

---

## Input Validation & Error Handling

### Schema Validation with Zod (Mandatory)

All API inputs **must be validated** using a schema library (Zod recommended). No manual `if (!field)` validation logic allowed.

**Install Zod:**
```bash
npm install zod
```

**Define schemas in service/domain layer:**
```typescript
// core/domain/contracts/schemas/contract-schemas.ts
import { z } from 'zod';
import { CONTRACT_STATUS } from '@/core/constants/status';

export const CreateContractSchema = z.object({
  name: z.string().min(1, 'Contract name required').max(200),
  description: z.string().max(2000).optional(),
  status: z.enum([CONTRACT_STATUS.DRAFT, CONTRACT_STATUS.IN_REVIEW, CONTRACT_STATUS.APPROVED]),
  counterparty: z.string().min(1, 'Counterparty required'),
  value: z.number().positive('Contract value must be positive').optional(),
  start_date: z.string().datetime('Invalid start date'),
  end_date: z.string().datetime('Invalid end date').optional(),
  owner_id: z.string().uuid('Invalid owner ID'),
});

export const UpdateContractSchema = CreateContractSchema.partial();

export const ContractFiltersSchema = z.object({
  status: z.enum(Object.values(CONTRACT_STATUS) as [string, ...string[]]).optional(),
  search: z.string().max(100).optional(),
  owner_id: z.string().uuid().optional(),
  created_after: z.string().datetime().optional(),
});

export type CreateContractDTO = z.infer<typeof CreateContractSchema>;
export type UpdateContractDTO = z.infer<typeof UpdateContractSchema>;
export type ContractFilters = z.infer<typeof ContractFiltersSchema>;
```

**Validation in service layer:**
```typescript
// core/domain/contracts/contracts-service.ts
import { CreateContractSchema, type CreateContractDTO } from './schemas/contract-schemas';

export class ContractsService {
  async createContract(tenantId: string, userId: string, input: unknown): Promise<Contract> {
    // ✅ Validate with Zod (throws ZodError if invalid)
    const validated = CreateContractSchema.parse(input);
    
    // Business logic
    const contract = await this.contractRepository.create({
      ...validated,
      tenant_id: tenantId,
      created_by: userId,
    });
    
    return contract;
  }
}
```

**Error handling in API route:**
```typescript
// src/app/api/contracts/route.ts
import { ZodError } from 'zod';

export const POST = withAuth(async (req: NextRequest, session: Session) => {
  try {
    const body = await req.json();
    const contract = await contractsService.createContract(
      session.user.tenantId,
      session.user.id,
      body
    );
    return successResponse(res, { contract }, 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(res, {
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'Invalid input',
        errors: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    logger.error('Failed to create contract', { error, userId: session.user.id });
    return errorResponse(res, { code: 'INTERNAL_ERROR', statusCode: 500 });
  }
});
```

### Error Code Registry (Global)

All errors must use **predefined error codes** from a centralized registry. No inline error strings anywhere.

**File: `src/core/constants/error-codes.ts`**
```typescript
// Global error code registry
export const ERROR_CODES = {
  // Authentication errors (1xxx)
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  
  // Authorization errors (2xxx)
  ACCESS_DENIED: 'ACCESS_DENIED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  TENANT_MISMATCH: 'TENANT_MISMATCH',
  
  // Validation errors (3xxx)
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_IDEMPOTENCY_KEY: 'MISSING_IDEMPOTENCY_KEY',
  
  // Resource errors (4xxx)
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_DELETED: 'RESOURCE_DELETED',
  
  // Business logic errors (5xxx)
  CONTRACT_NOT_EDITABLE: 'CONTRACT_NOT_EDITABLE',
  CONTRACT_EXPIRED: 'CONTRACT_EXPIRED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  
  // Rate limiting (6xxx)
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  
  // System errors (9xxx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
```

**Usage:**
```typescript
import { ERROR_CODES } from '@/core/constants/error-codes';

// ✅ Use error codes
return errorResponse(res, {
  code: ERROR_CODES.RESOURCE_NOT_FOUND,
  statusCode: 404,
  message: 'Contract not found',
});

// ❌ NEVER use inline strings
return errorResponse(res, {
  code: 'not_found', // Forbidden!
  statusCode: 404,
});
```

### Validation Checklist

- [ ] All API inputs validated with Zod schemas
- [ ] Schemas defined in domain/service layer (not routes)
- [ ] ZodError caught and formatted with field-level details
- [ ] All errors use `ERROR_CODES` registry
- [ ] No manual `if (!field)` validation logic
- [ ] Error responses include error code + human-readable message

---

## Rate Limiting & Security Hardening

### Rate Limiting Policy (Mandatory)

All authentication and high-value endpoints **must be rate-limited** to prevent abuse.

**Required Rate Limits:**

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| `POST /api/auth/login` | 5 attempts | 1 minute | Per IP + email |
| `POST /api/auth/refresh` | 10 attempts | 1 minute | Per IP |
| `POST /api/contracts` | 20 creates | 1 minute | Per tenant |
| `POST /api/contracts/upload` | 5 uploads | 1 minute | Per user |
| `GET /api/*` | 100 requests | 1 minute | Per user |

**Implementation with Redis (recommended):**
```typescript
// core/infra/rate-limiting/redis-rate-limiter.ts
import { Redis } from 'ioredis';

export class RateLimiter {
  constructor(private redis: Redis) {}

  async checkLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    
    const allowed = current <= limit;
    const remaining = Math.max(0, limit - current);
    
    return { allowed, remaining };
  }
}
```

**API route integration:**
```typescript
// src/app/api/auth/login/route.ts
import { rateLimiter } from '@/core/infra/rate-limiting/redis-rate-limiter';
import { ERROR_CODES } from '@/core/constants/error-codes';

export const POST = async (req: NextRequest) => {
  const ip = req.headers.get('x-forwarded-for') || req.ip || 'unknown';
  const body = await req.json();
  const email = body.email;
  
  // Rate limit by IP + email combination
  const rateLimitKey = `ratelimit:login:${ip}:${email}`;
  const { allowed, remaining } = await rateLimiter.checkLimit(rateLimitKey, 5, 60);
  
  if (!allowed) {
    logger.warn('Rate limit exceeded for login', { ip, email });
    return errorResponse(res, {
      code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      statusCode: 429,
      message: 'Too many login attempts. Please try again later.',
      retryAfter: 60,
    });
  }
  
  // Proceed with login...
};
```

### Refresh Token Rotation (Critical Security)

Every time a refresh token is used, a **new refresh token must be issued** and the old one **immediately invalidated**.

**Implementation:**
```typescript
// core/infra/session/jwt-session-store.ts
export const refreshSession = async (oldRefreshToken: string): Promise<SessionTokens | null> => {
  // 1. Verify old refresh token
  const payload = await verifyToken(oldRefreshToken, 'refresh');
  if (!payload) return null;
  
  // 2. Check if token is already used (replay attack detection)
  const isRevoked = await revokedTokens.exists(oldRefreshToken);
  if (isRevoked) {
    logger.error('Refresh token reuse detected - possible replay attack', {
      employeeId: payload.employeeId,
    });
    // Invalidate all sessions for this user (security breach)
    await invalidateAllUserSessions(payload.employeeId);
    return null;
  }
  
  // 3. Generate new tokens
  const newAccessToken = await signToken(payload, 'access');
  const newRefreshToken = await signToken(payload, 'refresh');
  
  // 4. Revoke old refresh token immediately
  await revokedTokens.add(oldRefreshToken, limits.refreshTokenDays * 24 * 60 * 60);
  
  // 5. Return new tokens
  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};
```

### JWT Security Enhancements

All JWTs **must include** these claims:

```typescript
interface JWTPayload {
  sub: string;           // User ID
  email: string;         // User email
  tenant_id: string;     // Tenant ID (for multi-tenant isolation)
  role: string;          // User role (for RBAC)
  jti: string;           // Unique token ID (for revocation tracking)
  type: 'access' | 'refresh';  // Token type
  exp: number;           // Expiration timestamp
  iat: number;           // Issued at timestamp
}
```

**Token generation:**
```typescript
import { v4 as uuidv4 } from 'uuid';

const signToken = async (data: SessionData, type: TokenType) => {
  return await new SignJWT({
    ...data,
    tenant_id: data.tenantId,
    role: data.role,
    jti: uuidv4(), // Unique token ID
    type,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(type === 'access' ? '2d' : '7d')
    .sign(secretKey);
};
```

### Security Hardening Checklist

- [ ] Rate limiting on login (5/min per IP+email)
- [ ] Rate limiting on refresh (10/min per IP)
- [ ] Rate limiting on contract upload (5/min per user)
- [ ] Refresh token rotation enabled
- [ ] Old refresh tokens revoked immediately
- [ ] JWT includes `jti`, `tenant_id`, `role`
- [ ] Replay attack detection via revoked tokens cache
- [ ] All security events logged with context

---

## Background Jobs Architecture

### Job Layer (Future-Proofing)

Heavy operations **must not run inside API routes**. Use a background job system for asynchronous processing.

**Create job layer:**
```
core/
└── jobs/
    ├── email-jobs.ts            # Email sending
    ├── audit-jobs.ts            # Audit log batching
    ├── contract-jobs.ts         # PDF generation, OCR processing
    └── cleanup-jobs.ts          # Expired data cleanup
```

**Operations that MUST be background jobs:**
- ✅ Email sending (welcome emails, notifications)
- ✅ Audit log batching (write to separate audit DB)
- ✅ PDF generation from contracts
- ✅ OCR/document parsing
- ✅ Large file uploads/processing
- ✅ Batch data exports
- ✅ Scheduled cleanup (expired idempotency keys, soft-deleted records)

**Example job implementation (using BullMQ or similar):**
```typescript
// core/jobs/contract-jobs.ts
import { Queue, Worker } from 'bullmq';

const contractQueue = new Queue('contracts', {
  connection: redisConnection,
});

export const scheduleContractPdfGeneration = async (contractId: string, tenantId: string) => {
  await contractQueue.add('generate-pdf', {
    contractId,
    tenantId,
  });
};

const contractWorker = new Worker('contracts', async (job) => {
  if (job.name === 'generate-pdf') {
    const { contractId, tenantId } = job.data;
    logger.info('Generating PDF for contract', { contractId, tenantId });
    
    // Heavy PDF generation logic
    const pdfBuffer = await generateContractPdf(contractId);
    await uploadToStorage(pdfBuffer, `contracts/${contractId}.pdf`);
    
    logger.info('PDF generation complete', { contractId });
  }
}, { connection: redisConnection });
```

**API route delegates to job:**
```typescript
// src/app/api/contracts/[id]/generate-pdf/route.ts
export const POST = withAuth(async (req, session) => {
  const contractId = req.nextUrl.pathname.split('/')[3];
  
  // Validate contract exists and user has access
  const contract = await contractsService.getContract(session.user.tenantId, contractId);
  if (!contract) {
    return errorResponse(res, { code: ERROR_CODES.RESOURCE_NOT_FOUND, statusCode: 404 });
  }
  
  // Schedule background job (returns immediately)
  await scheduleContractPdfGeneration(contractId, session.user.tenantId);
  
  return successResponse(res, {
    message: 'PDF generation started',
    jobStatus: 'pending',
  }, 202); // 202 Accepted
});
```

### Job Infrastructure Requirements

- [ ] Background job queue setup (BullMQ, Inngest, or similar)
- [ ] Email sending via jobs (not inline)
- [ ] PDF generation via jobs
- [ ] File processing via jobs
- [ ] Audit logging batching
- [ ] Job monitoring and retry logic
- [ ] Dead letter queue for failed jobs

---

## Database Discipline

### Soft Delete Policy (Mandatory)

**No hard deletes** for critical business data. Use `deleted_at` timestamp for recoverability and compliance.

**Tables requiring soft deletes:**
- ✅ `contracts`
- ✅ `employees`
- ✅ `audit_logs`
- ✅ `documents`
- ✅ `tenants`

**Schema pattern:**
```sql
ALTER TABLE contracts ADD COLUMN deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX idx_contracts_deleted_at ON contracts(deleted_at) WHERE deleted_at IS NULL;
```

**Query pattern (always filter out deleted):**
```typescript
// ❌ WRONG - Includes deleted records
const contracts = await supabase
  .from('contracts')
  .select('*')
  .eq('tenant_id', tenantId);

// ✅ CORRECT - Filter out soft-deleted
const contracts = await supabase
  .from('contracts')
  .select('*')
  .eq('tenant_id', tenantId)
  .is('deleted_at', null); // Only active records
```

**Soft delete operation:**
```typescript
export class ContractRepository {
  async softDelete(id: string, tenantId: string): Promise<void> {
    const { error } = await this.supabase
      .from('contracts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null); // Don't re-delete already deleted
    
    if (error) throw error;
  }
  
  async restore(id: string, tenantId: string): Promise<void> {
    const { error } = await this.supabase
      .from('contracts')
      .update({ deleted_at: null })
      .eq('id', id)
      .eq('tenant_id', tenantId);
    
    if (error) throw error;
  }
}
```

### Migration Discipline (Mandatory)

Every database migration **must include** both up and down migrations.

**Migration Rules:**
1. **Never edit old migration files** (create new ones instead)
2. **All tables must include:**
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `tenant_id UUID NOT NULL REFERENCES tenants(id)` (for multi-tenant tables)
   - `created_at TIMESTAMPTZ DEFAULT NOW()`
   - `updated_at TIMESTAMPTZ DEFAULT NOW()`
   - `deleted_at TIMESTAMPTZ DEFAULT NULL` (for soft deletes)
3. **All migrations must be reversible** (down migration provided)
4. **Indexes on foreign keys and frequently-queried columns**

**Example migration:**
```sql
-- Up Migration: 20260213_create_contracts_table.sql
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'in_review', 'approved', 'executed', 'expired')),
  counterparty TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES employees(id),
  value DECIMAL(15,2),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX idx_contracts_tenant_id ON contracts(tenant_id);
CREATE INDEX idx_contracts_status ON contracts(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_contracts_owner_id ON contracts(owner_id);
CREATE INDEX idx_contracts_deleted_at ON contracts(deleted_at) WHERE deleted_at IS NULL;

-- RLS Policies
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts_tenant_isolation" ON contracts
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Down Migration: 20260213_create_contracts_table_down.sql
DROP TABLE IF EXISTS contracts CASCADE;
```

**Automated `updated_at` trigger:**
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Database Discipline Checklist

- [ ] Soft deletes via `deleted_at` for all critical tables
- [ ] All queries filter `WHERE deleted_at IS NULL`
- [ ] All tables include: `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`
- [ ] Every migration has up + down SQL
- [ ] Never edit old migration files
- [ ] Indexes on foreign keys and query columns
- [ ] RLS policies for tenant isolation
- [ ] `updated_at` trigger on all tables

---

## Observability & Monitoring

### Correlation ID (Request Tracing)

Every request **must include a correlation ID** that flows through the entire request lifecycle (client → API → DB → logs).

**Implementation:**

1. **Generate correlation ID in API entry point:**
```typescript
// src/core/http/with-correlation-id.ts
import { v4 as uuidv4 } from 'uuid';
import type { NextRequest } from 'next/server';

export function withCorrelationId(handler: Function) {
  return async (req: NextRequest, ...args: any[]) => {
    const correlationId = req.headers.get('X-Correlation-ID') || uuidv4();
    
    // Attach to request context
    (req as any).correlationId = correlationId;
    
    // Add to response headers
    const response = await handler(req, ...args);
    response.headers.set('X-Correlation-ID', correlationId);
    
    return response;
  };
}
```

2. **Include in all log statements:**
```typescript
import { logger } from '@/core/infra/logging/logger';

export const GET = withCorrelationId(withAuth(async (req, session) => {
  const correlationId = (req as any).correlationId;
  
  logger.info('Fetching contracts', {
    correlationId,
    userId: session.user.id,
    tenantId: session.user.tenantId,
  });
  
  // Business logic...
  
  logger.info('Contracts fetched successfully', {
    correlationId,
    count: contracts.length,
  });
  
  return successResponse(res, { contracts }, 200);
}));
```

3. **Pass through to database queries (as comment):**
```typescript
const { data, error } = await supabase
  .from('contracts')
  .select('*')
  .eq('tenant_id', tenantId)
  .is('deleted_at', null)
  // Add correlation ID as query comment for DB logs
  .explain({ analyze: false, verbose: false, settings: true, buffers: true, wal: true })
  .then(result => {
    logger.debug('Query executed', { correlationId, query: result });
    return result;
  });
```

4. **Client includes correlation ID in requests:**
```typescript
// src/core/client/api-client.ts
const correlationId = uuidv4();

const response = await fetch('/api/contracts', {
  headers: {
    'X-Correlation-ID': correlationId,
    'Authorization': `Bearer ${accessToken}`,
  },
});
```

### Structured Logging Enhancements

All logs **must include** correlation ID + contextual metadata:

```typescript
logger.info('Contract created', {
  correlationId,        // Request trace ID
  userId: session.user.id,
  tenantId: session.user.tenantId,
  contractId: contract.id,
  action: 'contract.created',
  duration_ms: Date.now() - startTime,
});
```

### Observability Checklist

- [ ] Correlation ID generated for every request
- [ ] Correlation ID passed through entire request lifecycle
- [ ] All logs include `correlationId` field
- [ ] Correlation ID returned in response headers
- [ ] Request/response duration tracked
- [ ] Errors include correlation ID for incident tracing

---

## Feature Module Boundaries

### Module Structure (Prevent Monolithic Growth)

Each major feature **must live in its own module** under `modules/` directory.

**Required structure:**
```
modules/
├── auth/
│   ├── hooks/                  # React hooks (useLogin, useSession)
│   ├── ui/                     # UI components (LoginForm, SessionProvider)
│   └── tests/                  # Feature-specific tests
├── contracts/
│   ├── hooks/                  # useContracts, useContractUpload
│   ├── ui/                     # ContractList, ContractDetail, ContractUploadForm
│   └── tests/
├── tenants/
│   ├── hooks/
│   ├── ui/
│   └── tests/
└── templates/
    ├── hooks/
    ├── ui/
    └── tests/
```

**Module isolation rules:**
- ✅ Each module can import from `core/` (shared utilities, config)
- ✅ Each module can import from `lib/` (pure utilities)
- ✅ Each module can import types from other modules
- ❌ Modules **cannot import implementation** from other modules
- ❌ Modules **cannot import** from `app/` (pages/routes)

**Example:**
```typescript
// ✅ ALLOWED - Import shared utilities
import { apiClient } from '@/core/client/api-client';
import { logger } from '@/core/infra/logging/logger';
import { routes } from '@/core/config/route-registry';

// ✅ ALLOWED - Import types from other modules
import type { Tenant } from '@/modules/tenants/types';

// ❌ FORBIDDEN - Import implementation from other modules
import { useTenants } from '@/modules/tenants/hooks/use-tenants'; // WRONG!
import { TenantSelector } from '@/modules/tenants/ui/TenantSelector'; // WRONG!
```

**Shared components go in `components/`:**
```typescript
// components/ is for truly shared, reusable UI components
components/
├── ui/
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Modal.tsx
│   └── Table.tsx
└── layouts/
    ├── AppLayout.tsx
    └── DashboardLayout.tsx
```

### Feature Boundaries Checklist

- [ ] Each major feature in `modules/[feature]/`
- [ ] Each module has `hooks/`, `ui/`, `tests/` subdirectories
- [ ] Modules only import from `core/`, `lib/`, or types from other modules
- [ ] Shared UI components in `components/`
- [ ] Feature-specific components in `modules/[feature]/ui/`

---

## Data Residency Strategy

### Regional Isolation (Compliance)

For enterprise compliance (GDPR, data sovereignty), the system **must support** deploying databases per region and assigning tenants to specific regions.

**Tenant schema enhancement:**
```sql
ALTER TABLE tenants ADD COLUMN region TEXT NOT NULL DEFAULT 'us-east-1';
ALTER TABLE tenants ADD CONSTRAINT check_valid_region 
  CHECK (region IN ('us-east-1', 'eu-west-1', 'ap-southeast-1'));

CREATE INDEX idx_tenants_region ON tenants(region);
```

**Database router (future implementation):**
```typescript
// core/infra/database/database-router.ts
export class DatabaseRouter {
  private connections: Map<string, SupabaseClient>;
  
  constructor() {
    this.connections = new Map([
      ['us-east-1', createClient(process.env.SUPABASE_US_URL!, process.env.SUPABASE_US_KEY!)],
      ['eu-west-1', createClient(process.env.SUPABASE_EU_URL!, process.env.SUPABASE_EU_KEY!)],
      ['ap-southeast-1', createClient(process.env.SUPABASE_AP_URL!, process.env.SUPABASE_AP_KEY!)],
    ]);
  }
  
  getClient(region: string): SupabaseClient {
    const client = this.connections.get(region);
    if (!client) {
      throw new Error(`No database configured for region: ${region}`);
    }
    return client;
  }
}
```

**Service layer integration:**
```typescript
export class ContractsService {
  constructor(
    private databaseRouter: DatabaseRouter,
    private tenantRepository: ITenantRepository
  ) {}
  
  async getContract(tenantId: string, contractId: string): Promise<Contract | null> {
    // 1. Lookup tenant's region
    const tenant = await this.tenantRepository.findById(tenantId);
    if (!tenant) throw new Error('Tenant not found');
    
    // 2. Route to correct regional database
    const supabase = this.databaseRouter.getClient(tenant.region);
    
    // 3. Query from regional DB
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', contractId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single();
    
    if (error) throw error;
    return data;
  }
}
```

**Configuration:**
```typescript
// src/core/config/regions.ts
export const SUPPORTED_REGIONS = {
  US_EAST_1: 'us-east-1',
  EU_WEST_1: 'eu-west-1',
  AP_SOUTHEAST_1: 'ap-southeast-1',
} as const;

export const REGION_METADATA = {
  [SUPPORTED_REGIONS.US_EAST_1]: {
    name: 'US East (N. Virginia)',
    compliance: ['SOC2', 'HIPAA'],
  },
  [SUPPORTED_REGIONS.EU_WEST_1]: {
    name: 'EU West (Ireland)',
    compliance: ['GDPR', 'ISO 27001'],
  },
  [SUPPORTED_REGIONS.AP_SOUTHEAST_1]: {
    name: 'Asia Pacific (Singapore)',
    compliance: ['PDPA'],
  },
};
```

### Data Residency Requirements

- [ ] Tenants have `region` field
- [ ] Database router can connect to multiple regional DBs
- [ ] Service layer routes queries based on tenant region
- [ ] Admin UI allows setting tenant region during onboarding
- [ ] Cross-region queries prevented (compliance violation)
- [ ] Audit logs track which region data accessed from

---

## MCP Usage Guidelines

### What is MCP?

Model Context Protocol (MCP) servers provide LLMs with:
- Real-time access to codebase files and directory structures
- Database schema introspection (Supabase)
- Framework-specific patterns and conventions (Next.js)

### Configured MCP Servers

1. **Supabase MCP** (`@modelcontextprotocol/server-supabase`)
   - **Capabilities:** View database schema, run queries, inspect RLS policies
   - **Use when:** Need to understand table structures, column types, relationships
   - **Command:** Configured in `.mcp.json`

2. **Next.js MCP** (`@modelcontextprotocol/server-everything` with Next.js focus)
   - **Capabilities:** Understand routing, API patterns, server/client component rules
   - **Use when:** Building new routes, Server Components, API handlers
   - **Command:** Configured in `.mcp.json`

3. **Filesystem MCP** (Built-in)
   - **Capabilities:** Navigate codebase, read/write files
   - **Use when:** Need to explore project structure, refactor code
   - **Command:** Available by default in VS Code

### When to Use MCP During Development

| Task | MCP Server | Example Query |
|------|-----------|---------------|
| Build new API route | Next.js MCP | "Show me successful POST /api/auth/login pattern" |
| Add database migration | Supabase MCP | "What columns does the employees table have?" |
| Understand RLS | Supabase MCP | "Show RLS policies on contracts table" |
| Explore patterns | Next.js MCP | "How should I structure a protected API route?" |
| Refactor module | Filesystem MCP | "Find all imports of auth-service.ts" |

### Forbidden MCP Misuse

- **❌ DO NOT:** Ask MCP to "redesign the entire authentication system" (AI should refactor within architecture, not overhaul)
- **❌ DO NOT:** Trust MCP schema output without verifying against actual migrations
- **❌ DO NOT:** Use MCP to generate migrations (always write SQL migrations manually with Supabase CLI)

---

## Code Quality Standards

### TypeScript Rules

1. **Strict Mode Enabled**
   - All TypeScript files use `strict: true` in `tsconfig.json`
   - No `any` types without explicit `@ts-ignore` comment (with justification)
   - All function parameters and return types must be annotated

   ```typescript
   // ✅ Correct
   function getUserById(id: string): Promise<User | null> {
     return fetch(`/api/users/${id}`).then(r => r.json());
   }

   // ❌ Incorrect (implicit any)
   function getUserById(id) {
     // ...
   }
   ```

2. **Type Definitions**
   - Keep types colocated with implementation (e.g., `auth-service.ts` exports both service and types)
   - Alternatively, create `types.ts` in same directory for related types
   - Never use inline types for complex objects; extract to named types

3. **Generic Constraints**
   - Use generics to enforce type safety (especially for utility functions)
   - Document generic constraints with brief comments

   ```typescript
   // ✅ Clear generic usage
   function createRepository<T extends { id: string }>(data: T[]): Repository<T> {
     // ...
   }
   ```

### Code Organization

#### Directory Structure Rules

```
src/
├── app/                    # Next.js app directory (pages, layouts, API routes)
├── components/             # React components (Client Components)
├── core/                   # Core application logic (NOT a dumping ground)
│   ├── client/            # HTTP clients, SDK wrappers
│   ├── config/            # App configuration, constants
│   ├── constants/         # Enums, error codes, magic numbers
│   ├── domain/            # Business logic (services, repositories, guards)
│   ├── http/              # HTTP utilities (request/response, auth wraps)
│   ├── infra/             # Infrastructure (DB clients, OAuth, logging)
│   └── presenters/        # Response formatters, DTO builders
├── lib/                   # Utility functions, helpers (stateless)
├── modules/               # Feature-specific modules (hooks, hooks only)
└── types/                 # Global type definitions (database, API contracts)
```

**Rule:** Every file must have a clear, single responsibility. If a file does 3+ things, split it.

### Naming Conventions

- **Files:** `kebab-case` for all files (`employee-login-form.tsx`)
- **Components:** PascalCase (`EmployeeLoginForm`)
- **Functions/Variables:** camelCase (`getUserById`, `isAuthorized`)
- **Constants:** UPPER_SNAKE_CASE (only for rarely-changing constants; prefer typed enums)
- **Types/Interfaces:** PascalCase (`UserSession`, `AuthError`)

```typescript
// ✅ Correct naming
interface EmployeeCredentials { }
const MAX_LOGIN_ATTEMPTS = 5;
function validateDomain(email: string): boolean { }
export const EmployeeLoginForm = () => { };

// ❌ Incorrect
interface employee_credentials { }
const maxLoginAttempts = 5; // Should be const, not variable
function validate_domain() { }
export const employeeLoginForm = () => { };
```

### ESLint Configuration

- Config: `.eslintrc` (auto-generated via `npm init @eslint/config`)
- Run: `npm run lint` (checks all ts/tsx files)
- Fix: `npm run lint -- --fix` (auto-fix where possible)
- **Pre-commit check:** Husky + lint-staged runs ESLint on staged files

**Common ESLint Rules to Follow:**
- No unused variables
- No `console.log` in production code (use `logger` instead)
- Imports must be sorted and deduplicated
- No implicit `any` types

### Prettier Formatting

- Config: `.prettierrc`
- Ignore rules: `.prettierignore`
- Run: `npm run format` (all ts/tsx/json/md files)
- Settings:
  - **Quotes:** Single (`'`)
  - **Tabs:** 2 spaces
  - **Line Width:** 120 characters
  - **Arrow Parens:** Always

```typescript
// ✅ Correct formatting (Prettier applies automatically)
const greeting = 'Hello, World!';
const isValid = (x: string) => x.length > 0;

// ❌ Before Prettier (gets reformatted automatically)
const greeting = "Hello, World!"
const isValid = x => x.length > 0
```

### Comments & Documentation

- **JSDoc:** Use for public APIs (functions exported from services, utilities)
- **Inline Comments:** Explain WHY, not WHAT (code should be clear enough to explain WHAT)
- **No Comment Rot:** Update comments when code changes; outdated comments are worse than no comments

```typescript
// ✅ Useful comment explaining complexity
/**
 * Validates employee email against company domain.
 * Uses regex to handle subdomains (e.g., legal.company.com).
 * @param email - Employee email address
 * @returns true if email domain is whitelisted
 */
function validateDomain(email: string): boolean {
  const domain = email.split('@')[1];
  // Support subdomain emails: legal.company.com -> company.com
  const baseDomain = domain.split('.').slice(-2).join('.');
  return whitelistedDomains.includes(baseDomain);
}

// ❌ Redundant comment (code is self-explanatory)
const MAX_ATTEMPTS = 5; // Set max attempts to 5
```

---

## Performance Guidelines

### API Response Times

- **Target:** 95th percentile response time < 500ms
- **Acceptable:** 95th percentile < 1 second
- **Critical Issue:** Any endpoint consistently > 2 seconds (requires optimization)

### Data Fetching

1. **Server-Side Queries Preferred**
   - Use Next.js Server Components to fetch data server-side
   - Send pre-rendered HTML instead of fetching in browser (faster, SEO-friendly)

2. **Pagination for Large Result Sets**
   - Never fetch > 1000 records in single query
- **Cursor-based pagination is mandatory** (not offset-limit)
- Default page size: 50 records (configurable via `limits.paginationPageSize`)
- All list endpoints must support pagination filters
- File: `src/core/domain/...` (implement pagination service)

**Pagination Rules (Mandatory for Enterprise Scale):**
```typescript
// ❌ FORBIDDEN - Offset-based pagination doesn't scale
.range((page - 1) * 50, page * 50); // BAD!

// ✅ REQUIRED - Cursor-based pagination
export async function listContractsPaginated(
  tenantId: string,
  cursor?: string,
  limit: number = limits.paginationPageSize
) {
  let query = supabase
    .from('contracts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit + 1); // Fetch one extra to detect end
  
  if (cursor) {
    query = query.gt('id', cursor); // Resume from cursor
  }
  
  const { data } = await query;
  const hasMore = data.length > limit;
  const results = hasMore ? data.slice(0, -1) : data;
  const nextCursor = hasMore ? results[results.length - 1].id : null;
  
  return { results, nextCursor, hasMore };
}

// API Response Format
{
  data: [...contracts...],
  pagination: {
    nextCursor: 'contract_id_xyz',
    hasMore: true,
    limit: 50
  }
}
```
3. **Caching Strategy**
   - Next.js App Router caching: `revalidate` option in `fetch()` calls
   - Database: Leverage PostgreSQL indexes on frequently-queried columns
   - Client-side: React Query or SWR for repeated requests (implement as needed)

```typescript
// ✅ Server Component with revalidation
import { CONTRACT_CACHE_DURATION } from '@/core/constants/limits';

async function ContractList() {
  const contracts = await fetch('https://db.../contracts', {
    next: { revalidate: CONTRACT_CACHE_DURATION }, // Revalidate every 5 minutes
  });
  return <div>...</div>;
}

// ❌ Anti-pattern (client-side fetching for every visit)
export function ContractList() {
  const [contracts, setContracts] = useState([]);
  useEffect(() => {
    fetch('https://db.../contracts').then(r => r.json()).then(setContracts);
  }, []);
  return <div>...</div>;
}
```

### Bundle Size Optimization

- **Goal:** Main JavaScript bundle < 200 KB (gzipped)
- **Check:** Run `npm run build` and inspect `.next/static/chunks/` output
- **Technique:** Dynamic imports for large features

```typescript
// ✅ Load heavy component only when needed
const PDFViewer = dynamic(() => import('@/components/PDFViewer'), {
  loading: () => <div>Loading...</div>,
});

// ❌ Bloats main bundle
import PDFViewer from '@/components/PDFViewer';
```

### Database Query Optimization

- **Index Strategy:** Index on `WHERE` and `JOIN` columns
- **Query Pattern:** Use Supabase query helpers for pagination, filtering
- **N+1 Prevention:** Always join related tables in single query, not loops

```typescript
// ✅ Single query with join
const contracts = await supabase
  .from('contracts')
  .select('*, employee:employees(name, email)')
  .eq('status', 'active');

// ❌ N+1 query antipattern
const contracts = await supabase.from('contracts').select('*').eq('status', 'active');
const withEmployees = contracts.map(async (c) => ({
  ...c,
  employee: await supabase.from('employees').select('*').eq('id', c.employee_id).single(),
}));
```

---

## Logging Requirements

### Logging Framework

- **Library:** Built-in `src/core/infra/logging/logger.ts`
- **Output Format:** Structured JSON (not human-readable text in production)
- **Environment-Based Levels:**
  - **Development:** DEBUG (all logs)
  - **Production:** WARN, ERROR (critical issues only)

### Log Levels

| Level | When to Use | Example |
|-------|-----------|---------|
| DEBUG | Development debugging, request/response details | `logger.debug('Token payload:', tokenData)` |
| INFO  | Normal app operations, user actions | `logger.info('User logged in', { userId })` |
| WARN  | Recoverable issues, deprecated APIs | `logger.warn('Retry attempt 2 of 3', { endpoint })` |
| ERROR | Errors affecting functionality | `logger.error('Database connection failed', { error })` |

### Logging Rules

1. **Log Context, Not Secrets**
   - ✅ `logger.debug('Validating user', { email: 'user@company.com', status: 'active' })`
   - ❌ `logger.debug('Token', { token: jwtToken })` (never log tokens, secrets, passwords)

2. **Structured Logging**
   - All logs include context object (second parameter)
   - Fields: `userId`, `correlationId`, `endpoint`, `duration`, `error`, `attempt`

3. **Error Logging**
   - Always include full error stack trace in ERROR level logs
   - Include request/response context when available

```typescript
// ✅ Proper error logging
logger.error('Token refresh failed', {
  error: err.message,
  stack: err.stack,
  userId,
  endpoint: '/api/auth/refresh',
  refreshTokenValid: false,
});

// ❌ Insufficient context
logger.error('Error occurred');
```

4. **Performance Monitoring (future)**
   - Log API endpoint latency: `duration_ms` field
   - Alert on endpoints > 1 second
   - Use for identifying performance bottlenecks

```typescript
const startTime = performance.now();
const response = await someApiCall();
const duration = performance.now() - startTime;
logger.info('API call completed', { endpoint: '/api/contracts', duration_ms: duration });
```

---

## Edge Case Discipline

### Token Expiry Handling

**Scenario:** User makes API request, access token expired just before request.

**Expected Behavior:**
1. API returns 401 Unauthorized
2. Client interceptor automatically calls `POST /api/auth/refresh`
3. If refresh succeeds: Retry original request with new token
4. If refresh fails (refresh token expired): Redirect to login

**Implementation:** `src/core/client/api-client.ts` handles this automatically.

**Test Case to Verify:**
```typescript
// Simulate token expiry during request
// 1. Set accessToken to expired JWT
// 2. Make API request
// 3. Verify request is retried after refresh
// 4. Confirm response returns correct data (not error)
```

### Network Failures & Retries

**Scenario:** User connection drops or server temporarily unavailable.

**Expected Behavior:**
- Retry with exponential backoff (max 2 attempts)
- Backoff formula: `100ms * 2^attempt` (100ms, 200ms)
- Don't retry: 401 (auth error), 403 (permission), 4xx (client errors)
- Do retry: 500, 502, 503, 504 (server errors), network timeouts

**Implementation:** `src/core/client/api-client.ts`

**Test Case:**
```typescript
// Simulate network failure for first attempt, success on second
// Verify retry happens automatically, user sees no error
```

### Concurrent API Requests During Token Refresh

**Scenario:** Multiple API requests start while token refresh is in progress.

**Expected Behavior:**
- All requests should queue and wait for refresh to complete
- Once refresh succeeds, all queued requests proceed with new token
- If refresh fails, all queued requests reject with 401

**Implementation:** `src/core/client/api-client.ts` implements request queue

### Session Timeout Edge Cases

**Scenario:** User leaves browser tab open for hours, session expires.

**Expected Behavior:**
1. Next user action (click, form submit) triggers API request
2. Refresh token check happens automatically
3. If refresh succeeds silently, user continues uninterrupted
4. If refresh fails: User redirected to login with message "Session expired"

**Test Case:**
```typescript
// 1. Set refresh token to expire in 1 hour
// 2. Wait > 1 hour (or manually advance time in tests)
// 3. Try to make API request
// 4. Verify user is redirected to login
```

### Database & Permission Errors

**Scenario:** RLS policy denies user access to resource.

**Expected Behavior:**
1. Database returns error (403 or permission denied)
2. API returns structured error response: `{ error: 'ACCESS_DENIED', message: '...' }`
3. Client displays user-friendly message (not technical SQL error)
4. Client logs error with full context (userId, resource, reason)

**Implementation:** `src/core/http/response.ts` error formatter

### Error Code Consistency

All API errors must use predefined error codes (no ad-hoc error strings).

**File:** `src/core/constants/auth-errors.ts`

```typescript
// ✅ Use defined error code
return errorResponse(res, {
  code: 'INVALID_CREDENTIALS',
  statusCode: 401,
  message: 'Email or password is incorrect',
});

// ❌ Ad-hoc error string (breaks client error handling)
return res.status(401).json({ error: 'Wrong username or password' });
```

---

## Common Patterns

### Creating a Protected API Route

**File:** `src/app/api/[feature]/route.ts`

```typescript
import { withAuth } from '@/core/http/with-auth';
import { successResponse, errorResponse } from '@/core/http/response';
import type { NextRequest } from 'next/server';
import type { Session } from '@/core/domain/auth/types';

export const GET = withAuth(async (req: NextRequest, session: Session) => {
  try {
    // Your logic here - session is guaranteed to be present
    const data = await someService.getData(session.user.id);
    return successResponse(res, data, 200);
  } catch (error) {
    logger.error('API error', { error, userId: session.user.id });
    return errorResponse(res, { code: 'INTERNAL_ERROR', statusCode: 500 });
  }
});
```

### Fetching Data in Server Component

**File:** Any `.tsx` file in `app/` directory

```typescript
// ✅ Server Component (default in Next.js 16 App Router)
async function ContractList() {
  const contracts = await fetch('https://your-api.../contracts', {
    headers: {
      'Authorization': `Bearer ${accessToken}`, // From server cookies
    },
    next: { revalidate: 300 }, // Cache for 5 minutes
  }).then(r => r.json());

  return (
    <div>
      {contracts.map(c => <ContractCard key={c.id} contract={c} />)}
    </div>
  );
}
```

### Fetching Data in Client Component

**File:** Component marked with `'use client'`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/core/client/api-client';

export function ContractList() {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/api/contracts')
      .then(setContracts)
      .catch(err => logger.error('Failed to load contracts', { error: err }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading...</div>;
  return <div>{contracts.map(c => <ContractCard key={c.id} contract={c} />)}</div>;
}
```

### Using the Logger

```typescript
import { logger } from '@/core/infra/logging/logger';

// Debug level (dev only)
logger.debug('User session created', { userId: user.id, email: user.email });

// Info level (important operations)
logger.info('Contract uploaded', { userId, contractId, fileSize: 2048000 });

// Warn level (recoverable issues)
logger.warn('API retry attempt', { endpoint: '/api/contracts', attempt: 2, maxAttempts: 3 });

// Error level (failures)
logger.error('Database query failed', { 
  error: err.message, 
  stack: err.stack, 
  query: 'SELECT * FROM contracts WHERE id = $1' 
});
```

### Adding a New Environment Variable

1. Add to `.env.local` (local development):
   ```
   NEXT_PUBLIC_API_URL=http://localhost:3000
   SUPABASE_SECRET_KEY=sk_...
   ```

2. Reference via `process.env`:
   - **Server-side only:** `process.env.SUPABASE_SECRET_KEY`
   - **Client-side:** `process.env.NEXT_PUBLIC_API_URL` (prefixed with `NEXT_PUBLIC_`)

3. Type-check in `src/core/config/env.server.ts` or `env.public.ts`

---

## Forbidden Patterns

### ❌ Middleware for Request Authentication

**DON'T DO THIS:**

```typescript
// middleware.ts - WRONG APPROACH
export async function middleware(request: NextRequest) {
  const token = request.cookies.get('accessToken')?.value;
  if (!token) return NextResponse.redirect('/login');
  // Check if token is valid, etc.
}

export const config = {
  matcher: ['/api/(.*)', '/dashboard/(.*)'],
};
```

**Instead, use the proxy pattern:**

```typescript
// src/core/http/with-auth.ts
export const GET = withAuth(async (req, session) => {
  // Authentication guaranteed here
});
```

**Reason:** Explicit per-route protection is more testable and maintainable. Middleware is a global hammer; routes deserve explicit contracts.

### ❌ Untyped Database Queries

**DON'T:**

```typescript
const result = await supabase
  .from('contracts')
  .select('*');

// No type safety, might be null, could be error
console.log(result.data.map(c => c.field_that_doesnt_exist));
```

**DO:**

```typescript
import type { Database } from '@/types/database';

type Contract = Database['public']['Tables']['contracts']['Row'];

const { data, error } = await supabase
  .from('contracts')
  .select('*')
  .returns<Contract[]>();

if (error) throw error;
const field = data[0].id; // ✅ TypeScript knows 'id' exists
```

### ❌ Console Logging in Production

**DON'T:**

```typescript
console.log('User logged in:', user);
console.error('Database error:', dbError);
```

**DO:**

```typescript
logger.info('User logged in', { userId: user.id });
logger.error('Database error', { error: dbError.message, stack: dbError.stack });
```

**Reason:** Production logs need structured JSON format, environment-based filtering (no DEBUG in prod), and secrets redaction.

### ❌ Explicit `any` Type Without Justification

**DON'T:**

```typescript
function processData(data: any): any {
  return data.something;
}
```

**DO:**

```typescript
interface DataShape {
  something: string;
}

function processData(data: DataShape): string {
  return data.something;
}

// If you MUST use any (rare), add comment:
function legacyApiHandler(response: any /* API returns inconsistent structure */) {
  return response?.data?.user;
}
```

### ❌ Hardcoded Configuration Values

**DON'T:**

```typescript
const MAX_LOGIN_ATTEMPTS = 5;
const DATABASE_URL = 'postgresql://localhost/nxtlegal';
const API_TIMEOUT = 30000;

// Scattered throughout codebase - impossible to maintain
```

**DO:**

```typescript
// src/core/constants/limits.ts
export const MAX_LOGIN_ATTEMPTS = 5;
export const API_TIMEOUT = 30000;

// src/core/config/app-config.ts
export const config = {
  database: {
    url: process.env.DATABASE_URL,
  },
};
```

### ❌ Logging Secrets or Sensitive Data

**DON'T:**

```typescript
logger.debug('Auth attempt', { password: user.password, token: jwtToken });
logger.info('API request', { authHeader: req.headers.authorization });
```

**DO:**

```typescript
logger.debug('Auth attempt', { email: user.email, success: true });
logger.info('API request', { endpoint: '/api/contracts', method: 'GET' });
```

### ❌ Multiple Responsibilities in Single File

**DON'T:**

```typescript
// employee-service.ts (does too much)
export class EmployeeService {
  async getEmployee(id: string) { }
  async sendNotificationEmail(email: string) { }
  async logToAuditTrail(action: string) { }
  async formatEmployeeResponse(emp: Employee) { }
}
```

**DO:**

```typescript
// employee-repository.ts (data access only)
export class EmployeeRepository {
  async getEmployee(id: string) { }
}

// employee-service.ts (business logic only)
export class EmployeeService {
  async getEmployee(id: string) { }
}

// email-service.ts (notifications)
export class EmailService {
  async sendNotificationEmail(email: string) { }
}

// audit-logger.ts (audit trail)
export class AuditLogger {
  async log(action: string) { }
}
```

### ❌ Skipping Error Handling

**DON'T:**

```typescript
const data = JSON.parse(userInput); // What if invalid JSON?
const result = await fetch(url); // What if network fails?
const token = getTokenFromCookie(); // What if missing?
```

**DO:**

```typescript
try {
  const data = JSON.parse(userInput);
} catch (e) {
  logger.warn('Invalid JSON input', { error: e.message });
  return errorResponse(res, { code: 'INVALID_JSON', statusCode: 400 });
}

try {
  const result = await fetch(url);
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
} catch (e) {
  logger.error('API request failed', { url, error: e.message });
  return errorResponse(res, { code: 'EXTERNAL_API_ERROR', statusCode: 502 });
}

const token = getTokenFromCookie();
if (!token) {
  return errorResponse(res, { code: 'MISSING_TOKEN', statusCode: 401 });
}
```

### ❌ Circular Dependencies

**DON'T:**

```typescript
// auth-service.ts
import { userRepository } from './user-repository';

// user-repository.ts
import { authService } from './auth-service'; // Circular!
```

**DO:**

Use dependency injection or reorganize module structure to break cycles.

```typescript
// auth-service.ts
export class AuthService {
  constructor(private userRepository: UserRepository) { }
}

// app.ts
const userRepository = new UserRepository();
const authService = new AuthService(userRepository);
```

### ❌ Business Logic in API Routes

**DON'T DO THIS:**

```typescript
// src/app/api/contracts/route.ts - WRONG APPROACH
export const GET = withAuth(async (req, session) => {
  // ❌ Complex validation logic here
  const status = req.nextUrl.searchParams.get('status');
  if (!status || !['draft', 'approved', 'executed'].includes(status)) {
    return Response.json({ error: 'Invalid status' }, { status: 400 });
  }
  
  // ❌ Business logic scattered in route
  const { data } = await supabase
    .from('contracts')
    .select('*')
    .eq('status', status)
    .eq('tenant_id', session.user.tenantId);
  
  // ❌ Response formatting in route
  const formatted = data.map(c => ({
    id: c.id,
    name: c.name,
    status: c.status,
    owner: c.owner_id === session.user.id ? 'me' : 'other',
    permissions: calculatePermissions(c, session.user), // ← Logic in route!
  }));
  
  return Response.json({ contracts: formatted });
});
```

**DO THIS INSTEAD:**

```typescript
// src/core/domain/contracts/contracts-service.ts - Business logic
export class ContractsService {
  async listContracts(
    tenantId: string,
    userId: string,
    filters: ContractFilters
  ): Promise<ContractDTO[]> {
    // ✅ Validation here
    validateContractFilters(filters);
    
    // ✅ Business logic here
    const contracts = await this.contractRepository.findByTenant(tenantId, filters);
    const permitted = contracts.filter(c => this.canAccess(c, userId));
    
    // ✅ Response formatting here
    return this.contractPresenter.toDTO(permitted);
  }
}

// src/app/api/contracts/route.ts - Thin orchestration
export const GET = withAuth(async (req, session) => {
  try {
    const status = req.nextUrl.searchParams.get('status') || undefined;
    // ✅ Delegate to service
    const contracts = await contractsService.listContracts(
      session.user.tenantId,
      session.user.id,
      { status }
    );
    // ✅ Format and return
    return successResponse(res, { contracts }, 200);
  } catch (error) {
    logger.error('Failed to fetch contracts', { error: error.message, userId: session.user.id });
    return errorResponse(res, { code: 'FETCH_FAILED', statusCode: 500 });
  }
});
```

**API Route Responsibility:**
1. Parse request (query params, body)
2. Call relevant service/domain logic
3. Format and return response
4. Handle and log errors

✅ **NOTHING ELSE.** No validation, filtering, permission checks, data transformation. Those belong in services.

### ❌ Magic Numbers

**DON'T:**

```typescript
if (retryCount > 3) { } // What does 3 mean?
const timeout = 30000; // 30 seconds? Milliseconds?
```

**DO:**

```typescript
const MAX_RETRIES = 3;
if (retryCount > MAX_RETRIES) { }

const TIMEOUT_MS = 30 * 1000; // 30 seconds
```

---

## Testing Requirements

### Critical Services (Unit Tests Required)

All critical domain services **must** have unit tests. These services handle business logic, permissions, and data integrity.

**Services that MUST have tests:**
- `ContractsService` - Contract lifecycle logic
- `AuthService` - Authentication and token handling
- `TenantService` - Multi-tenant isolation
- `PermissionService` - Authorization and access control
- `ContractValidationService` - Business rule validation

**Example test structure:**
```typescript
// src/core/domain/contracts/contracts-service.test.ts
import { ContractsService } from './contracts-service';
import { describe, it, expect, beforeEach } from '@jest/globals';

describe('ContractsService', () => {
  let service: ContractsService;
  let mockRepository: jest.Mock;

  beforeEach(() => {
    mockRepository = jest.fn();
    service = new ContractsService(mockRepository);
  });

  it('should filter contracts by tenant', async () => {
    const tenantId = 'tenant_123';
    const contracts = await service.listContracts(tenantId, { status: 'active' });
    expect(mockRepository).toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
    expect(contracts).toBeDefined();
  });

  it('should prevent cross-tenant data access', async () => {
    const tenantA = 'tenant_a';
    const tenantB = 'tenant_b';
    const contractsA = await service.listContracts(tenantA, {});
    const contractsB = await service.listContracts(tenantB, {});
    expect(contractsA).not.toEqual(contractsB);
  });
});
```

### Authentication & Authorization (Integration Tests Required)

All auth flows must be integration tested:
- OAuth callback flow
- JWT refresh token flow
- Token expiry and renewal
- Session timeout handling
- Permission enforcement

**Example integration test:**
```typescript
// src/core/domain/auth/auth-service.integration.test.ts
it('should auto-refresh expired access token', async () => {
  // 1. Create session with short expiry
  const session = await authService.createSession(userData);
  
  // 2. Verify token is valid
  expect(session.accessToken).toBeDefined();
  
  // 3. Simulate expiry (advance time)
  jest.useFakeTimers();
  jest.advanceTimersByTime(2 * 24 * 60 * 60 * 1000); // 2 days + 1ms
  
  // 4. Call refresh endpoint
  const refreshed = await authService.refreshToken(session.refreshToken);
  
  // 5. Verify new access token issued
  expect(refreshed.accessToken).not.toEqual(session.accessToken);
  expect(refreshed.accessToken).toBeDefined();
});
```

### Edge Cases (Required Before Release)

**Test these scenarios before deploying:**
- Token expiry during active request
- Network failure during token refresh
- Concurrent requests during token refresh
- Database connection failure
- Invalid/missing permissions
- Tenant isolation breach attempts
- Pagination cursor at boundary
- Large file uploads (within limits)

**Checklist template:**
```typescript
// BEFORE RELEASE - Run these scenarios
const edgeCasesToTest = [
  'expired_token_mid_request',
  'network_failure_on_refresh',
  'concurrent_requests_during_refresh',
  'db_connection_failure',
  'missing_tenant_id_in_query',
  'invalid_pagination_cursor',
  'oversized_file_upload',
  'cross_tenant_access_attempt',
  'default_authorization_check',
];
```

### Testing Best Practices

1. **Mock external dependencies** (Supabase, OAuth providers)
2. **Test permission boundaries** explicitly
3. **Test tenant isolation** (default deny, not default allow)
4. **Verify error responses** (no internal detail leakage)
5. **Test pagination edge cases** (empty results, boundary conditions)

---

## Quick Reference

### Common Commands

```bash
# Development
npm run dev                    # Start local dev server (http://localhost:3000)
npm run build                 # Production build
npm run lint                  # Check code quality (ESLint)
npm run format                # Auto-format code (Prettier)
npm run type-check            # TypeScript strict mode check

# Database
npx supabase migration new <name>  # Create new migration
npx supabase db push              # Apply migrations to local/prod database

# Utilities
npm run scripts/hash-password     # Hash password for testing
```

### File Location Quick Index

| Task | File Location |
|------|---------------|
| Add new API route | `src/app/api/[feature]/route.ts` |
| Protect API route | Import `withAuth` from `src/core/http/with-auth.ts` |
| Add authentication method | `src/components/auth/` or `src/infra/auth/` |
| Define new error code | `src/core/constants/auth-errors.ts` |
| Add log statement | Import `logger` from `src/core/infra/logging/logger.ts` |
| Update config | `src/core/config/` |
| Add database type | `src/types/database.ts` |
| Create utility | `src/lib/` |
| Create feature hook | `src/modules/[feature]/ui/` |
| Add UI component | `src/components/` |

### TypeScript Type Checking

```bash
# Check all files
npx tsc --noEmit

# Watch mode (recheck on save)
npx tsc --watch --noEmit
```

### Security Checklist Before Deployment

- [ ] No hardcoded secrets (API keys, tokens) in code
- [ ] All environment variables documented in `.env.example`
- [ ] Security headers configured in `next.config.ts`
- [ ] RLS policies verified on all tables
- [ ] Token expiry times appropriate (access 2d, refresh 7d)
- [ ] Error messages don't leak internal details
- [ ] Logging doesn't include PII or secrets
- [ ] CORS configured properly (if needed)
- [ ] HTTPS enforced in production (HSTS header)

### Common Gotchas

| Issue | Solution |
|-------|----------|
| Client component imports server-only code | Add `'use client'` directive at top of file |
| Token expires mid-request | API client auto-refresh handled; doesn't require code |
| Prettier conflicts with ESLint | Run `npm run format` after `npm run lint` |
| TypeScript `strict: true` errors | Annotate all function parameters and return types |
| RLS policy blocks legitimate queries | Verify `Authorization` header set correctly |
| API returns 401 unexpectedly | Check token expiry with `logger.debug` |

---

## Decision Framework

### When to create a new service vs. utility

- **Service:** Handles domain logic, has dependencies, can fail (goes in `src/core/domain/`)
- **Utility:** Pure function, no side effects, stateless (goes in `src/lib/`)

Example:
- `src/core/domain/auth/auth-service.ts` (validate JWT, manage sessions)
- `src/lib/auth/require-user.ts` (export user from request headers)

### When to add new MCP server

- **Add if:** Entire new framework/platform integrated (e.g., Stripe, OpenAI, Salesforce)
- **Don't add if:** Internal module or utility that's not foreign

### When to create a new table vs. column

- **New table:** Different entity with own lifecycle (e.g., `contracts`, `employees`, `audit_logs`)
- **New column:** Attribute of existing entity (e.g., `employees.department`, `contracts.status`)

---

## Continuous Improvement

### How to Request Architecture Changes

If proposed change conflicts with these guidelines:

1. **Document the issue:** What limitation exists?
2. **Propose alternative:** How could guidelines be updated?
3. **Get approval:** CTO (manager) reviews and approves
4. **Update this file:** Add new pattern or exception

No changes to architecture without updating this document.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | Feb 13, 2026 | **Enterprise-Grade Hardening**: Domain layer purity, idempotency support, Zod validation, global error codes, rate limiting, refresh token rotation, JWT enhancements (jti/tenant_id/role), background jobs architecture, soft delete policy, migration discipline, correlation ID observability, feature module boundaries, data residency strategy |
| 1.1 | Feb 13, 2026 | CTO enhancements: Zero hardcoding enforcement, mandatory cursor pagination, multi-tenant isolation rules, thin API routes, testing requirements, SameSite cookie correction |
| 1.0 | Feb 13, 2026 | Initial comprehensive guidelines for NXT Legal development |

**Document Owner:** Engineering Manager / CTO  
**Last Updated:** Feb 13, 2026 (v2.0)  
**Next Review:** When new major features added or architecture changed
