import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Child ERP — All-in-one cloud ERP",
  description: "Accounting, Sales, Inventory, Procurement, Manufacturing, CRM, HR, Payroll, Projects, POS and Reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
