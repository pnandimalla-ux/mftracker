import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import InsightsClient from "./InsightsClient";

export default async function InsightsPage() {
  const { user, failed } = await getAuthedUser();

  if (failed) {
    redirect("/login?error=session");
  }

  if (!user) {
    redirect("/login");
  }

  return <InsightsClient userEmail={user.email ?? ""} />;
}
