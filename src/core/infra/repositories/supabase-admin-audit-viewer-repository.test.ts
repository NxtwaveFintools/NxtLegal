import type { IAuditViewerRepository } from '@/core/domain/admin/audit-viewer-service'

describe('supabaseAdminAuditViewerRepository pagination count optimization', () => {
  afterEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  const loadRepository = async (from: jest.Mock): Promise<IAuditViewerRepository> => {
    jest.doMock('@/lib/supabase/service', () => ({
      createServiceSupabase: () => ({ from }),
    }))

    const loadedRepositoryModule =
      (await import('@/core/infra/repositories/supabase-admin-audit-viewer-repository')) as {
        supabaseAdminAuditViewerRepository: IAuditViewerRepository
      }

    return loadedRepositoryModule.supabaseAdminAuditViewerRepository
  }

  const createDataBuilder = () => {
    const builder: Record<string, jest.Mock> = {}
    const dataRows = [
      {
        id: 'log-1',
        user_id: 'actor-non-uuid',
        action: 'admin.user.created',
        event_type: null,
        actor_email: 'admin@nxtwave.co.in',
        actor_role: 'SUPER_ADMIN',
        target_email: null,
        note_text: null,
        resource_type: 'user',
        resource_id: 'resource-1',
        changes: null,
        metadata: null,
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ]

    const lt = jest.fn().mockResolvedValue({
      data: dataRows,
      error: null,
    })

    const limit = jest.fn().mockReturnValue(builder)
    const order = jest.fn().mockReturnValue(builder)
    const dataOr = jest.fn().mockReturnValue(builder)
    const dataGte = jest.fn().mockReturnValue(builder)
    const dataLte = jest.fn().mockReturnValue(builder)
    const dataEq = jest.fn().mockReturnValue(builder)

    Object.assign(builder, {
      eq: dataEq,
      order,
      limit,
      lt,
      gte: dataGte,
      lte: dataLte,
      or: dataOr,
      data: dataRows,
      error: null,
    })

    return {
      select: jest.fn().mockReturnValue({
        ...builder,
      }),
      dataEq,
      lt,
    }
  }

  const createCountBuilder = () => {
    const builder: Record<string, jest.Mock> = {}
    const countOr = jest.fn().mockResolvedValue({ count: 1, error: null })
    const countGte = jest.fn().mockReturnValue(builder)
    const countLte = jest.fn().mockReturnValue(builder)
    const countEq = jest.fn().mockReturnValue(builder)

    Object.assign(builder, {
      eq: countEq,
      gte: countGte,
      lte: countLte,
      or: countOr,
      count: 1,
      error: null,
    })

    return {
      select: jest.fn().mockReturnValue({
        ...builder,
      }),
    }
  }

  it('skips exact count query when cursor is provided', async () => {
    const dataBuilder = createDataBuilder()
    const from = jest.fn().mockReturnValue(dataBuilder)
    const repository = await loadRepository(from)

    const result = await repository.list({
      tenantId: 'tenant-1',
      filters: {},
      cursor: Buffer.from('2026-02-28T00:00:00.000Z', 'utf8').toString('base64url'),
      limit: 25,
    })

    expect(result.total).toBe(0)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('runs exact count query on first page', async () => {
    const countBuilder = createCountBuilder()
    const dataBuilder = createDataBuilder()
    const from = jest.fn().mockReturnValueOnce(countBuilder).mockReturnValueOnce(dataBuilder)
    const repository = await loadRepository(from)

    const result = await repository.list({
      tenantId: 'tenant-1',
      filters: {},
      limit: 25,
    })

    expect(result.total).toBe(1)
    expect(from).toHaveBeenCalledTimes(2)
  })
})
