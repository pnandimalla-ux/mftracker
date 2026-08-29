import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import ImportClient from "./ImportClient";
import type { MFCASImport } from "@/types/mf";

export default async function ImportPage() {
  const { supabase, user, failed } = await getAuthedUser();

  if (failed || !supabase) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-700">
            Unable to connect to the database right now.
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    redirect("/login");
  }

  let importHistory: MFCASImport[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_cas_imports")
      .select("*")
      .eq("user_id", user.id)
      .order("imported_at", { ascending: false });

    if (error) throw error;
    importHistory = (data ?? []) as MFCASImport[];
  } catch (err) {
    console.error("Import page: failed to load import history", err);
    importHistory = [];
  }

  return (
    <ImportClient userEmail={user.email ?? ""} initialImportHistory={importHistory} />
  );
}
