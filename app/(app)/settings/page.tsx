import { requireSession, listUsers } from "@/lib/auth";
import { get } from "@/lib/db";
import { CompanyForm, FbrForm, UserForm } from "@/components/SettingsForms";
import { fbrSettings } from "@/lib/fbr";

export default async function SettingsPage() {
  const s = await requireSession();
  const company = get<any>(`SELECT name, ntn, address, phone, currency FROM companies WHERE id=?`, s.companyId)!;
  const users = listUsers(s.companyId);
  const admin = s.role === "admin";
  const fbr = fbrSettings(s.companyId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section><h2 className="mb-2 font-semibold">Company profile</h2><CompanyForm company={company} canEdit={admin} /></section>
      <section>
        <h2 className="mb-1 font-semibold">FBR digital invoicing</h2>
        <p className="mb-2 text-sm text-slate-500">Uses the company NTN and address above. Start in Sandbox; switch to Production only after FBR has approved your sandbox scenarios.</p>
        <FbrForm settings={fbr} canEdit={admin} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Users</h2>
        <div className="card mb-3 overflow-x-auto">
          <table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
            <tbody>{users.map((u: any) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td><span className="badge">{u.role}</span></td></tr>)}</tbody></table>
        </div>
        {admin ? <UserForm /> : <p className="text-sm text-slate-500">Only administrators can add users.</p>}
      </section>
    </div>
  );
}
