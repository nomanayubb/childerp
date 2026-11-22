import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { entityMap } from "@/lib/schema";
import { loadFormSupport } from "@/lib/formdata";
import { today } from "@/lib/format";
import EntityForm from "@/components/EntityForm";

type SP = Record<string, string | string[] | undefined>;

export default async function NewEntity({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: Promise<SP> }) {
  const s = await requireSession();
  const { entity } = await params;
  const sp = await searchParams;
  const e = entityMap[entity];
  if (!e || e.noCreate) notFound();

  // Allow links like /e/receipts/new?invoice_id=5 to pre-fill known fields.
  const preset: Record<string, string> = {};
  for (const f of e.fields) {
    const v = sp[f.name];
    if (typeof v === "string" && !f.readonly) preset[f.name] = v;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/e/${e.key}`} className="text-sm text-teal-700 hover:underline">← {e.plural}</Link>
      <h1 className="mb-4 mt-1 text-2xl font-bold">New {e.label.toLowerCase()}</h1>
      <EntityForm
        entity={e} row={null} lines={[]} locked={false} preset={preset} today={today()}
        {...loadFormSupport(s.companyId, e)}
      />
    </div>
  );
}
