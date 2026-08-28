import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppHeader from "@/components/AppHeader";

export default async function ImportPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader userEmail={user.email ?? ""} />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-700">
            CAS import is coming soon
          </p>
        </div>
      </main>
    </div>
  );
}
