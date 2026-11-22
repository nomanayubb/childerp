import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { MODULES } from "@/lib/schema";
import { navModules } from "@/lib/nav";
import { REPORTS } from "@/lib/nav";

export default async function ModuleOverview({ params }: { params: Promise<{ module: string }> }) {
  await requireSession();
  const { module } = await params;
  const meta = MODULES.find((m) => m.key === module);
  if (!meta) notFound();
  const nav = navModules().find((m) => m.key === module)!;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">{meta.icon} {meta.label}</h1>
      <p className="mb-5 text-slate-500">{meta.desc}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {nav.items.map((i) => (
          <Link key={i.href} href={i.href} className="card p-4 font-medium text-teal-800 transition hover:border-teal-500 hover:shadow">
            {i.label}
            {module === "reports" && <div className="mt-1 text-xs font-normal text-slate-500">{REPORTS.find((r) => i.href.endsWith(r.key))?.desc}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}
