"use client";

export default function ConfirmButton({
  children, message, className = "btn",
}: { children: React.ReactNode; message?: string; className?: string }) {
  return (
    <button
      className={className}
      onClick={(e) => { if (message && !window.confirm(message)) e.preventDefault(); }}
    >
      {children}
    </button>
  );
}
