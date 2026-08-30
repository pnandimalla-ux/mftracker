import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import SettingsClient from "./SettingsClient";
import type { MFSyncLog } from "@/types/mf";

export default async function SettingsPage() {
  const { supabase, user, failed } = await getAuthedUser();

  if (failed) {
    redirect("/login?error=session");
  }

  if (!user) {
    redirect("/login");
  }

  let syncLog: MFSyncLog[] = [];
  let heldGroups: string[] = [];

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("mf_sync_log")
        .select("*")
        .order("run_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      syncLog = (data ?? []) as MFSyncLog[];
    } catch (err) {
      console.error("Settings page: failed to load sync log", err);
      syncLog = [];
    }

    try {
      const { data, error } = await supabase
        .from("mf_holdings")
        .select("category, peer_group")
        .eq("user_id", user.id);
      if (error) throw error;
      heldGroups = Array.from(
        new Set(
          (data ?? [])
            .map((h) => (h.peer_group as string | null) ?? (h.category as string | null))
            .filter((c): c is string => !!c)
        )
      );
    } catch (err) {
      console.error("Settings page: failed to load held categories", err);
      heldGroups = [];
    }
  }

  return (
    <SettingsClient userEmail={user.email ?? ""} initialSyncLog={syncLog} heldGroups={heldGroups} />
  );
}
