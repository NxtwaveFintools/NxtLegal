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
    contracts: {
      list: '/api/contracts',
      upload: '/api/contracts/upload',
      detail: '/api/contracts/:contractId',
      download: '/api/contracts/:contractId/download',
      timeline: '/api/contracts/:contractId/timeline',
      action: '/api/contracts/:contractId/action',
      note: '/api/contracts/:contractId/note',
      approvers: '/api/contracts/:contractId/approvers',
    },
  },
} as const
