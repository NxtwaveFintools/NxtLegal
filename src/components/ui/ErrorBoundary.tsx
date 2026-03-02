'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

/**
 * Reusable React Error Boundary (class component — required by React).
 *
 * Catches render errors in child trees and displays a localized fallback UI
 * instead of crashing the entire workspace. The rest of the page stays alive.
 *
 * @prop sectionLabel  — Human-readable label shown in the fallback (e.g. "contract details").
 * @prop resetKey      — When this value changes the boundary auto-resets (e.g. selectedContractId).
 * @prop fallback      — Optional custom fallback element to render instead of the default.
 */

interface ErrorBoundaryProps {
  children: ReactNode
  /** Label shown in the fallback UI to identify the section that crashed */
  sectionLabel?: string
  /** Key that, when changed, auto-resets the boundary (e.g. a route param or selected ID) */
  resetKey?: string | number | null
  /** Optional fully-custom fallback element */
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log for observability — in prod this would route to a structured logger
    console.error(`[ErrorBoundary] ${this.props.sectionLabel ?? 'Section'} crashed:`, error, errorInfo.componentStack)
  }

  componentDidUpdate(prevProps: Readonly<ErrorBoundaryProps>): void {
    // Auto-reset when the context changes (e.g. user selects a different contract)
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      const label = this.props.sectionLabel ? ` in ${this.props.sectionLabel}` : ''

      return (
        <div className={styles.fallback}>
          <div className={styles.icon} aria-hidden="true">
            ⚠️
          </div>
          <h3 className={styles.heading}>Something went wrong{label}</h3>
          <p className={styles.description}>
            An unexpected error occurred while rendering this section. Your other workspace panels are unaffected.
          </p>
          <button type="button" className={styles.retryButton} onClick={this.handleRetry}>
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
