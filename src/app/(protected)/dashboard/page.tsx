import { getAuthenticatedEmployeeView } from '@/core/presenters/auth-presenter'
import { appConfig } from '@/core/config/app-config'
import LogoutButton from '@/components/auth/LogoutButton'

export default async function DashboardPage() {
  const session = await getAuthenticatedEmployeeView()
  const allowedDomains = appConfig.auth.allowedDomains.join(', ')

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
              <p className="text-sm text-gray-500 mt-1">Welcome to NXT Legal Employee Portal</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* User Info Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Account Information</h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-gray-500">Employee ID:</span>
              <p className="text-lg text-gray-900 font-mono">{session.employeeId}</p>
            </div>
            {session.fullName && (
              <div>
                <span className="text-sm font-medium text-gray-500">Name:</span>
                <p className="text-lg text-gray-900">{session.fullName}</p>
              </div>
            )}
            {session.email && (
              <div>
                <span className="text-sm font-medium text-gray-500">Email:</span>
                <p className="text-lg text-gray-900">{session.email}</p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Documents</h3>
            <p className="text-gray-600 text-sm">Access and manage your legal documents</p>
            <button className="mt-4 text-blue-600 hover:text-blue-700 font-medium text-sm">View Documents →</button>
          </div>

          <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Cases</h3>
            <p className="text-gray-600 text-sm">Track and manage active cases</p>
            <button className="mt-4 text-blue-600 hover:text-blue-700 font-medium text-sm">View Cases →</button>
          </div>

          <div className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Settings</h3>
            <p className="text-gray-600 text-sm">Configure your account preferences</p>
            <button className="mt-4 text-blue-600 hover:text-blue-700 font-medium text-sm">Open Settings →</button>
          </div>
        </div>

        {/* Protected Route Info */}
        <div className="mt-8 bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="shrink-0">
              <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-green-800">Protected Route</h3>
              <p className="mt-1 text-sm text-green-700">
                This page is protected and only accessible to authenticated {allowedDomains} employees.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
