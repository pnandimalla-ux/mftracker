import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import SIPCalendarClient from "./SIPCalendarClient";
import type { MFSIPSchedule, Owner, SIPFrequency } from "@/types/mf";

const SAMPLE_SIPS: {
  owner: Owner;
  scheme_name: string;
  category: string;
  amount: number;
  sip_date: number;
  frequency: SIPFrequency;
  start_date: string;
}[] = [
  {
    owner: "praveen",
    scheme_name: "Mirae Asset Large Cap Fund",
    category: "Large Cap",
    amount: 5000,
    sip_date: 5,
    frequency: "monthly",
    start_date: "2025-01-05",
  },
  {
    owner: "praveen",
    scheme_name: "HDFC Mid-Cap Opportunities Fund",
    category: "Mid Cap",
    amount: 3000,
    sip_date: 10,
    frequency: "monthly",
    start_date: "2025-01-10",
  },
  {
    owner: "geetha",
    scheme_name: "Axis Bluechip Fund",
    category: "Large Cap",
    amount: 3000,
    sip_date: 7,
    frequency: "monthly",
    start_date: "2025-01-07",
  },
  {
    owner: "geetha",
    scheme_name: "Kotak Emerging Equity Fund",
    category: "Mid Cap",
    amount: 2000,
    sip_date: 15,
    frequency: "monthly",
    start_date: "2025-01-15",
  },
];

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
    const { count } = await supabase
      .from("mf_sip_schedules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (!count) {
      await supabase.from("mf_sip_schedules").insert(
        SAMPLE_SIPS.map((sip) => ({ ...sip, user_id: user!.id }))
      );
    }

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
