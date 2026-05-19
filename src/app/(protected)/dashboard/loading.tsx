export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 animate-pulse">
        <div className="space-y-3">
          <div className="h-4 w-32 rounded-full bg-slate-200" />
          <div className="h-10 w-72 rounded-2xl bg-slate-200" />
          <div className="h-4 w-56 rounded-full bg-slate-200" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="h-3 w-24 rounded-full bg-slate-200" />
              <div className="mt-4 h-8 w-16 rounded-2xl bg-slate-200" />
              <div className="mt-5 h-3 w-32 rounded-full bg-slate-200" />
            </div>
          ))}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="h-5 w-40 rounded-full bg-slate-200" />
            <div className="flex gap-3">
              <div className="h-10 w-40 rounded-2xl bg-slate-200" />
              <div className="h-10 w-28 rounded-2xl bg-slate-200" />
            </div>
          </div>
          <div className="space-y-4 px-5 py-5">
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div
                key={row}
                className="flex flex-col gap-3 rounded-2xl border border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-2">
                  <div className="h-4 w-44 rounded-full bg-slate-200" />
                  <div className="h-3 w-56 rounded-full bg-slate-200" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-8 w-24 rounded-full bg-slate-200" />
                  <div className="h-9 w-24 rounded-2xl bg-slate-200" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
