export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] animate-pulse">
        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="h-5 w-28 rounded-full bg-slate-200" />
          <div className="mt-5 space-y-3">
            {[0, 1, 2, 3, 4].map((item) => (
              <div key={item} className="h-11 rounded-2xl bg-slate-200" />
            ))}
          </div>
        </aside>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="h-4 w-24 rounded-full bg-slate-200" />
            <div className="mt-3 h-9 w-64 rounded-2xl bg-slate-200" />
            <div className="mt-3 h-4 w-80 rounded-full bg-slate-200" />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div key={item} className="rounded-2xl border border-slate-100 p-4">
                  <div className="h-4 w-32 rounded-full bg-slate-200" />
                  <div className="mt-4 h-10 w-full rounded-2xl bg-slate-200" />
                  <div className="mt-3 h-3 w-24 rounded-full bg-slate-200" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
