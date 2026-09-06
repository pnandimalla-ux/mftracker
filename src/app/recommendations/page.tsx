import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import RecommendationsClient from "./RecommendationsClient";

export default async function RecommendationsPage() {
  const { user, failed } = await getAuthedUser();

  if (failed) {
    redirect("/login?error=session");
  }

  if (!user) {
    redirect("/login");
  }

  return <RecommendationsClient userEmail={user.email ?? ""} />;
}
