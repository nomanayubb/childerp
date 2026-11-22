"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export interface NavModule {
  key: string;
  label: string;
  icon: string;
  items: { href: string; label: string }[];
}

export default function Sidebar({ modules }: { modules: NavModule[] }) {
  const path = usePathname();
  const active = modules.find((m) => m.items.some((i) => path.startsWith(i.href.split("?")[0])) || path === `/m/${m.key}`)?.key;
  const [open, setOpen] = useState<string | null>(active ?? null);
  const [mobile, setMobile] = useState(false);

  const nav = (
    <nav className="space-y-0.5 p-3 text-sm" aria-label="Main">
      <Link href="/" className={`flex items-center gap-2 rounded-md px-3 py-2 font-medium ${path === "/" ? "bg-teal-700 text-white" : "text-slate-200 hover:bg-white/10"}`}>
        <span aria-hidden>🏠</span> Dashboard
      </Link>
      {modules.map((m) => {
        const isOpen = open === m.key;
        return (
          <div key={m.key}>
            <button
              onClick={() => setOpen(isOpen ? null : m.key)}
              aria-expanded={isOpen}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left font-medium ${active === m.key ? "bg-white/10 text-white" : "text-slate-200 hover:bg-white/10"}`}
            >
              <span className="flex items-center gap-2"><span aria-hidden>{m.icon}</span>{m.label}</span>
              <span aria-hidden className="text-xs">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                <Link href={`/m/${m.key}`} onClick={() => setMobile(false)} className={`block rounded px-2 py-1 text-slate-300 hover:text-white ${path === `/m/${m.key}` ? "font-semibold text-white" : ""}`}>Overview</Link>
                {m.items.map((i) => (
                  <Link key={i.href} href={i.href} onClick={() => setMobile(false)}
                    className={`block rounded px-2 py-1 ${path.startsWith(i.href.split("?")[0]) ? "font-semibold text-white" : "text-slate-300 hover:text-white"}`}>
                    {i.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Link href="/settings" className={`mt-2 flex items-center gap-2 rounded-md px-3 py-2 font-medium ${path === "/settings" ? "bg-teal-700 text-white" : "text-slate-200 hover:bg-white/10"}`}>
        <span aria-hidden>⚙️</span> Settings
      </Link>
    </nav>
  );

  return (
    <>
      <button onClick={() => setMobile(true)} aria-label="Open menu" className="fixed left-3 top-3 z-30 rounded-md bg-teal-800 px-3 py-2 text-white shadow lg:hidden">☰</button>
      <aside className="hidden w-64 shrink-0 overflow-y-auto bg-slate-900 lg:block">
        <div className="px-6 py-5 text-xl font-bold text-white">Child ERP</div>
        {nav}
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-slate-900">
            <div className="flex items-center justify-between px-6 py-5 text-xl font-bold text-white">
              Child ERP <button onClick={() => setMobile(false)} aria-label="Close menu">✕</button>
            </div>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
