"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, register, type FormState } from "@/lib/actions";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-900 via-teal-800 to-slate-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6">
          <div className="text-2xl font-bold text-teal-800">Child ERP</div>
          <h1 className="mt-4 text-xl font-semibold">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

const init: FormState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, init);
  return (
    <Shell title="Sign in" subtitle="Access your company's ERP workspace.">
      <form action={action} className="space-y-4">
        {state.error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">{state.error}</p>}
        <div><label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" defaultValue={state.values?.email} className="input" /></div>
        <div><label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="input" /></div>
        <button disabled={pending} className="btn btn-primary w-full">{pending ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        New company? <Link href="/register" className="font-medium text-teal-700 hover:underline">Create an account</Link>
      </p>
    </Shell>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, init);
  const v = state.values ?? {};
  return (
    <Shell title="Create your company" subtitle="Set up a new ERP workspace with a default chart of accounts.">
      <form action={action} className="space-y-4">
        {state.error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">{state.error}</p>}
        <div><label className="label" htmlFor="company">Company name</label>
          <input id="company" name="company" required defaultValue={v.company} className="input" /></div>
        <div><label className="label" htmlFor="name">Your name</label>
          <input id="name" name="name" required defaultValue={v.name} className="input" /></div>
        <div><label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" defaultValue={v.email} className="input" /></div>
        <div><label className="label" htmlFor="password">Password (min 8 characters)</label>
          <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input" /></div>
        <button disabled={pending} className="btn btn-primary w-full">{pending ? "Creating…" : "Create company"}</button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        Already registered? <Link href="/login" className="font-medium text-teal-700 hover:underline">Sign in</Link>
      </p>
    </Shell>
  );
}
