'use client'

import EmployeeLoginForm from '@/components/auth/EmployeeLoginForm'
import MicrosoftButton from '@/components/auth/MicrosoftButton'
import { publicConfig } from '@/core/config/public-config'
import { useLoginPage } from '@/modules/auth/ui/use-login-page'

export default function LoginPageContent() {
  const { error } = useLoginPage()
  const allowedDomainsText = publicConfig.auth.allowedDomains.join(', ')

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-gray-50 to-gray-100 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">NXT Legal</h1>
            <p className="text-gray-600">Employee Portal Login</p>
            <p className="text-sm text-blue-600 font-medium mt-2">Please use your Microsoft account to sign in</p>
          </div>

          {/* Error Message */}
          {error && <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}

          {publicConfig.features.enableMicrosoftOAuth && (
            <div className="mb-6">
              <MicrosoftButton />
            </div>
          )}

          {publicConfig.features.enableMicrosoftOAuth && publicConfig.features.enablePasswordLogin && (
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-600 font-medium">
                  If Microsoft not available, use backup login
                </span>
              </div>
            </div>
          )}

          {publicConfig.features.enablePasswordLogin && <EmployeeLoginForm />}

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-gray-500">
            <p className="flex items-center justify-center gap-1">
              <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Restricted to {allowedDomainsText} employees only</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
