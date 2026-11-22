"use client";

import { useActionState } from "react";
import { addUser, saveCompany, saveFbr, type FormState } from "@/lib/actions";
import { FBR_PROVINCES, FBR_SCENARIOS } from "@/lib/schema";

const init: FormState = {};

export function CompanyForm({ company, canEdit }: { company: { name: string; ntn: string | null; address: string | null; phone: string | null; currency: string }; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveCompany, init);
  const f = (name: keyof typeof company) => ({ name, defaultValue: company[name] ?? "", disabled: !canEdit, className: "input" });
  return (
    <form action={action} className="card grid gap-4 p-5 sm:grid-cols-2">
      <div><label className="label" htmlFor="c_name">Company name</label><input id="c_name" required {...f("name")} /></div>
      <div><label className="label" htmlFor="c_ntn">NTN / Tax ID (printed on invoices)</label><input id="c_ntn" {...f("ntn")} /></div>
      <div><label className="label" htmlFor="c_phone">Phone</label><input id="c_phone" {...f("phone")} /></div>
      <div><label className="label" htmlFor="c_cur">Currency code</label><input id="c_cur" maxLength={5} {...f("currency")} /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="c_addr">Address</label><textarea id="c_addr" rows={2} {...f("address")} /></div>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {canEdit && <div className="sm:col-span-2"><button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : "Save company"}</button></div>}
    </form>
  );
}

export function UserForm() {
  const [state, action, pending] = useActionState(addUser, init);
  const v = state.values ?? {};
  return (
    <form action={action} className="card grid gap-4 p-5 sm:grid-cols-2">
      <div><label className="label" htmlFor="u_name">Name</label><input id="u_name" name="name" required defaultValue={v.name} className="input" /></div>
      <div><label className="label" htmlFor="u_email">Email</label><input id="u_email" name="email" type="email" required defaultValue={v.email} className="input" /></div>
      <div><label className="label" htmlFor="u_pw">Temporary password (min 8)</label><input id="u_pw" name="password" type="password" minLength={8} required autoComplete="new-password" className="input" /></div>
      <div><label className="label" htmlFor="u_role">Role</label><select id="u_role" name="role" className="input"><option value="user">User</option><option value="admin">Administrator</option></select></div>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2"><button className="btn btn-primary" disabled={pending}>{pending ? "Adding…" : "Add user"}</button></div>
    </form>
  );
}

export function FbrForm({ settings, canEdit }: { settings: { env: string; province: string; scenario: string; hasToken: boolean; tokenHint: string }; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveFbr, init);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const intent = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        const env = (e.currentTarget.elements.namedItem("env") as HTMLSelectElement).value;
        if (intent !== "test" && env === "production" && !window.confirm("Production sends REAL invoices to FBR. Continue?")) e.preventDefault();
      }}
      className="card grid gap-4 p-5 sm:grid-cols-2"
    >
      {/* Re-key the fields when saved values change so they show what was stored. */}
      <div key={`${settings.env}|${settings.province}|${settings.scenario}|${settings.tokenHint}`} className="contents">
      <div><label className="label" htmlFor="fb_env">Environment</label>
        <select id="fb_env" name="env" defaultValue={settings.env} disabled={!canEdit} className="input">
          <option value="sandbox">Sandbox (testing, nothing is filed)</option>
          <option value="production">Production (real invoices)</option>
        </select></div>
      <div><label className="label" htmlFor="fb_prov">Seller province</label>
        <select id="fb_prov" name="province" defaultValue={settings.province} disabled={!canEdit} className="input">
          {FBR_PROVINCES.map((p) => <option key={p} value={p}>{p || "— select —"}</option>)}
        </select></div>
      <div>
        <label className="label" htmlFor="fb_tok">Security token {settings.hasToken && <span className="normal-case text-teal-700">(saved, ends …{settings.tokenHint})</span>}</label>
        <input id="fb_tok" name="token" type="password" autoComplete="off" disabled={!canEdit} className="input"
          placeholder={settings.hasToken ? "Leave blank to keep the saved token" : "Paste the token issued by FBR/PRAL"} />
        {settings.hasToken && canEdit && <label className="mt-1 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="clear_token" /> Remove saved token</label>}
      </div>
      <div><label className="label" htmlFor="fb_sc">Default sandbox scenario</label>
        <select id="fb_sc" name="scenario" defaultValue={settings.scenario} disabled={!canEdit} className="input">
          {FBR_SCENARIOS.map((c) => <option key={c}>{c}</option>)}
        </select></div>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.message && <p role="status" className="text-sm text-teal-700 sm:col-span-2">{state.message}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button name="__intent" value="save" className="btn btn-primary" disabled={pending}>{pending ? "Working…" : "Save FBR settings"}</button>
          <button name="__intent" value="test" className="btn" disabled={pending || !settings.hasToken}>Test connection</button>
        </div>
      )}
    </form>
  );
}
