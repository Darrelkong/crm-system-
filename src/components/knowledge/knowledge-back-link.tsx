import Link from "next/link";

export function KnowledgeBackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="secondary-button inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 ease-out"
    >
      {children}
    </Link>
  );
}
