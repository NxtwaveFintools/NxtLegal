export const routeRegistry = {
  public: {
    login: '/login',
    authCallback: '/auth/callback',
  },
  protected: {
    dashboard: '/dashboard',
  },
  api: {
    auth: {
      login: '/api/auth/login',
      logout: '/api/auth/logout',
      session: '/api/auth/session',
      refresh: '/api/auth/refresh',
    },
  },
} as const
