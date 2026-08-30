import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import SIPCalendarClient from "./SIPCalendarClient";
import type { MFSIPSchedule } from "@/types/mf";

function SIPPageError({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-700">{message}</p>
        <p className="mt-2 text-xs text-slate-400">
          Please try again shortly, or contact support if this continues.
        </p>
      </div>
    </div>
  );
}

export default async function SIPPage() {
  const { supabase, user, failed } = await getAuthedUser();

  if (failed || !supabase) {
    return (
      <SIPPageError message="Unable to connect to the database right now." />
    );
  }

  if (!user) {
    redirect("/login");
  }

  let sips: MFSIPSchedule[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_sip_schedules")
      .select("*")
      .eq("user_id", user.id)
      .order("sip_date", { ascending: true });

    if (error) throw error;
    sips = (data ?? []) as MFSIPSchedule[];
  } catch (err) {
    console.error("SIP page: failed to load SIP schedules", err);
    sips = [];
  }

  return <SIPCalendarClient userEmail={user.email ?? ""} initialSips={sips} />;
}
