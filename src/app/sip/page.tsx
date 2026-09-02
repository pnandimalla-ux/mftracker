import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import SIPCalendarClient, { type LumpsumEntry } from "./SIPCalendarClient";
import type { MFSIPSchedule, Owner } from "@/types/mf";

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

  let lumpsums: LumpsumEntry[] = [];

  try {
    const { data, error } = await supabase
      .from("mf_holdings")
      .select("as_on_date, amount:invested_amount, scheme_name, owner")
      .eq("user_id", user.id)
      .eq("lot_type", "lumpsum")
      .order("as_on_date", { ascending: false });

    if (error) throw error;
    lumpsums = (data ?? []).map((row) => ({
      trade_date: row.as_on_date as string,
      amount: row.amount as number,
      scheme_name: row.scheme_name as string,
      owner: row.owner as Owner,
    }));
  } catch (err) {
    console.error("SIP page: failed to load lumpsum holdings", err);
    lumpsums = [];
  }

  return (
    <SIPCalendarClient
      userEmail={user.email ?? ""}
      initialSips={sips}
      initialLumpsums={lumpsums}
    />
  );
}
