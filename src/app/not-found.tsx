import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center">
        {/* 404 Header */}
        <div className="mb-8">
          <h1 className="text-6xl font-bold text-gray-900 mb-2">404</h1>
          <p className="text-2xl font-semibold text-gray-700">Page Not Found</p>
        </div>

        {/* Description */}
        <p className="text-gray-600 text-lg mb-8">
          Sorry, the page you&apos;re looking for doesn&apos;t exist. It might have been moved or deleted.
        </p>

        {/* Error Icon */}
        <div className="mb-8">
          <svg className="w-24 h-24 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <Link
            href="/"
            className="inline-block w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition duration-200"
          >
            Go to Home
          </Link>
          <Link
            href="/login"
            className="inline-block w-full bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg transition duration-200"
          >
            Go to Login
          </Link>
        </div>

        {/* Footer */}
        <p className="mt-8 text-sm text-gray-500">
          If you think this is a mistake, please{' '}
          <a href="mailto:support@nxtwave.co.in" className="text-blue-600 hover:text-blue-700 font-medium">
            contact support
          </a>
        </p>
      </div>
    </div>
  )
}
