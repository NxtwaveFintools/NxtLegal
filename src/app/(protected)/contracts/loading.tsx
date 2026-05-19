export default function ContractsLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 animate-pulse">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="h-4 w-24 rounded-full bg-slate-200" />
            <div className="h-9 w-72 rounded-2xl bg-slate-200" />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="h-10 w-40 rounded-2xl bg-slate-200" />
            <div className="h-10 w-32 rounded-2xl bg-slate-200" />
            <div className="h-10 w-28 rounded-2xl bg-slate-200" />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div className="h-4 w-32 rounded-full bg-slate-200" />
            <div className="h-9 w-24 rounded-2xl bg-slate-200" />
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <div className="h-4 w-48 rounded-full bg-slate-200" />
                  <div className="h-3 w-64 rounded-full bg-slate-200" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-24 rounded-full bg-slate-200" />
                  <div className="h-9 w-20 rounded-2xl bg-slate-200" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
