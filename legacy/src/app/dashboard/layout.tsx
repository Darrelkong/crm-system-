import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="flex min-h-full bg-slate-50">
      <Sidebar
        userName={session?.user?.name ?? "User"}
        userEmail={session?.user?.email ?? ""}
      />
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
