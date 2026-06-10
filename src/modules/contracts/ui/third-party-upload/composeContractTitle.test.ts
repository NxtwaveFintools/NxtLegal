import { composeContractTitle } from '@/modules/contracts/ui/third-party-upload/composeContractTitle'

describe('composeContractTitle', () => {
  it('composes the title as "Contract Title - Type - Counterparty"', () => {
    const result = composeContractTitle({
      contractTitle: 'NIAT University Partnership',
      contractTypeName: 'MOU',
      counterpartyNames: ['Acme Corp'],
    })

    expect(result).toBe('NIAT University Partnership - MOU - Acme Corp')
  })

  it('joins multiple counterparties with a comma', () => {
    const result = composeContractTitle({
      contractTitle: 'Vendor Onboarding',
      contractTypeName: 'Service Agreement',
      counterpartyNames: ['Acme Corp', 'Globex'],
    })

    expect(result).toBe('Vendor Onboarding - Service Agreement - Acme Corp, Globex')
  })

  it('trims surrounding whitespace from every segment', () => {
    const result = composeContractTitle({
      contractTitle: '  Master Agreement  ',
      contractTypeName: '  MOU  ',
      counterpartyNames: ['  NA  '],
    })

    expect(result).toBe('Master Agreement - MOU - NA')
  })

  it('falls back to "Type - Counterparty" when no contract title is provided', () => {
    const result = composeContractTitle({
      contractTitle: '   ',
      contractTypeName: 'MOU',
      counterpartyNames: ['NA'],
    })

    expect(result).toBe('MOU - NA')
  })

  it('uses sensible fallbacks when type and counterparties are empty', () => {
    const result = composeContractTitle({
      contractTitle: 'Standalone',
      contractTypeName: '',
      counterpartyNames: [],
    })

    expect(result).toBe('Standalone - Contract - Counterparty')
  })
})
