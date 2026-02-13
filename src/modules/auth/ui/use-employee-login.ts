'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/core/client/auth-client'
import { authErrorMessages } from '@/core/constants/auth-errors'
import { limits } from '@/core/constants/limits'
import { routeRegistry } from '@/core/config/route-registry'

type EmployeeLoginState = {
  employeeId: string
  password: string
  error: string
  loading: boolean
  setEmployeeId: (value: string) => void
  setPassword: (value: string) => void
  submit: () => Promise<void>
}

export const useEmployeeLogin = (): EmployeeLoginState => {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')

    if (!employeeId.trim()) {
      setError('Please enter your Employee ID')
      return
    }

    if (!password) {
      setError('Please enter your password')
      return
    }

    if (password.length > limits.passwordMaxLength) {
      setError(`Password exceeds maximum length of ${limits.passwordMaxLength} characters`)
      return
    }

    setLoading(true)

    try {
      const response = await authClient.login(employeeId.toUpperCase(), password)

      if (!response || typeof response.ok !== 'boolean') {
        setError(authErrorMessages.auth_failed)
        setLoading(false)
        return
      }

      if (!response.ok) {
        setError(response.error?.message ?? authErrorMessages.auth_failed)
        setLoading(false)
        return
      }

      if (!response.data?.employee?.employeeId) {
        setError(authErrorMessages.auth_failed)
        setLoading(false)
        return
      }

      router.push(routeRegistry.protected.dashboard)
      router.refresh()
    } catch {
      setError(authErrorMessages.auth_failed)
      setLoading(false)
    }
  }

  return {
    employeeId,
    password,
    error,
    loading,
    setEmployeeId,
    setPassword,
    submit,
  }
}
