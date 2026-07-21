/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import GlobalSearchBar from '@/modules/dashboard/ui/GlobalSearchBar'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}))

describe('GlobalSearchBar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends an encoded query to the repository page on Enter', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: 'vendor msa' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockPush).toHaveBeenCalledWith('/repository?q=vendor%20msa')
  })

  it('trims surrounding whitespace from the query', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: '  nda  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockPush).toHaveBeenCalledWith('/repository?q=nda')
  })

  it('navigates to the bare repository route when the term is only whitespace', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockPush).toHaveBeenCalledWith('/repository')
  })

  it('does not navigate on keystrokes other than Enter', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    fireEvent.change(input, { target: { value: 'nda' } })
    fireEvent.keyDown(input, { key: 'a' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('focuses the input on Ctrl+K', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts')

    expect(document.activeElement).not.toBe(input)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(document.activeElement).toBe(input)
  })

  it('clears the value on Escape', () => {
    render(<GlobalSearchBar />)
    const input = screen.getByLabelText('Search contracts') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'nda' } })
    expect(input.value).toBe('nda')

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(input.value).toBe('')
    expect(mockPush).not.toHaveBeenCalled()
  })
})
