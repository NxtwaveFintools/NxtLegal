type ComposeContractTitleInput = {
  contractTitle: string
  contractTypeName: string
  counterpartyNames: string[]
}

/**
 * Builds the stored contract title shown in the repository and detail views.
 *
 * Format: `${Contract Title} - ${Contract Type} - ${Counterparty}` so each row
 * is uniquely identifiable. When no contract title is provided we fall back to
 * the legacy `${Type} - ${Counterparty}` shape.
 */
export function composeContractTitle({
  contractTitle,
  contractTypeName,
  counterpartyNames,
}: ComposeContractTitleInput): string {
  const title = contractTitle.trim()
  const typeName = contractTypeName.trim() || 'Contract'
  const counterpartySuffix =
    counterpartyNames
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .join(', ') || 'Counterparty'

  if (!title) {
    return `${typeName} - ${counterpartySuffix}`
  }

  return `${title} - ${typeName} - ${counterpartySuffix}`
}
