import { resolvePostUploadDestination } from '@/modules/contracts/ui/third-party-upload/resolvePostUploadDestination'

describe('resolvePostUploadDestination', () => {
  it('opens the new contract for a legal team member', () => {
    const result = resolvePostUploadDestination({ actorRole: 'LEGAL_TEAM', contractId: 'contract-42' })

    expect(result).toBe('/contracts/contract-42')
  })

  it('sends a regular user to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: 'USER', contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })

  it('sends an admin to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: 'ADMIN', contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })

  it('sends an HOD to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: 'HOD', contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })

  it('sends an unknown role to the dashboard', () => {
    const result = resolvePostUploadDestination({ actorRole: undefined, contractId: 'contract-42' })

    expect(result).toBe('/dashboard')
  })
})
