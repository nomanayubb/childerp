import { requireSession } from "@/lib/auth";
import { logout } from "@/lib/actions";
import { navModules } from "@/lib/nav";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      <div className="contents print:hidden"><Sidebar modules={navModules()} /></div>
      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 pl-14 lg:pl-6 print:hidden">
          <div className="font-semibold text-slate-800">{s.companyName}</div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 sm:inline">{s.name} · {s.role}</span>
            <form action={logout}><button className="btn">Sign out</button></form>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
