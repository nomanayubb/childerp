export default function Flash({ msg, error }: { msg?: string; error?: string }) {
  if (!msg && !error) return null;
  return error ? (
    <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
  ) : (
    <p role="status" className="mb-4 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">{msg}</p>
  );
}

export const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
