'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import Spinner from '@/components/ui/Spinner'
import { startGoogleOAuth } from '@/core/infra/auth/supabase-oauth-client'

export default function GoogleButton() {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const login = async () => {
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)

    try {
      await startGoogleOAuth()
      toast.success('Redirecting to Google sign-in')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      toast.error(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <button
      onClick={login}
      className="w-full bg-white text-gray-900 px-4 py-3 rounded font-medium border border-gray-300 hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-65 disabled:cursor-not-allowed"
      disabled={isSubmitting}
    >
      {isSubmitting ? <Spinner size={14} /> : null}
      <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M21.805 10.023h-9.804v3.955h5.617c-.242 1.273-.967 2.351-2.06 3.074v2.554h3.328c1.946-1.792 3.067-4.433 3.067-7.556 0-.678-.059-1.355-.148-2.027z"
          fill="#4285F4"
        />
        <path
          d="M12.001 22c2.776 0 5.11-.917 6.813-2.496l-3.328-2.554c-.924.624-2.106.991-3.485.991-2.672 0-4.936-1.804-5.744-4.231H2.83v2.635A10.29 10.29 0 0012.001 22z"
          fill="#34A853"
        />
        <path
          d="M6.257 13.71A6.188 6.188 0 015.934 12c0-.594.106-1.172.323-1.71V7.655H2.83A10.291 10.291 0 001.75 12c0 1.647.395 3.204 1.08 4.345l3.427-2.635z"
          fill="#FBBC05"
        />
        <path
          d="M12.001 6.059c1.507 0 2.857.52 3.918 1.538l2.939-2.939C17.106 3.032 14.772 2 12.001 2A10.29 10.29 0 002.83 7.655l3.427 2.635c.808-2.427 3.072-4.231 5.744-4.231z"
          fill="#EA4335"
        />
      </svg>
      {isSubmitting ? 'Redirecting...' : 'Sign in with Google'}
    </button>
  )
}
