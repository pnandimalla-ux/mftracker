import { redirect } from "next/navigation";
import { getAuthedUser } from "@/lib/supabase/getAuthedUser";
import FundDetailClient from "./FundDetailClient";

export default async function FundDetailPage({
  params,
}: {
  params: { scheme_code: string };
}) {
  const { user, failed } = await getAuthedUser();

  if (failed) {
    redirect("/login?error=session");
  }

  if (!user) {
    redirect("/login");
  }

  return (
    <FundDetailClient userEmail={user.email ?? ""} schemeCode={params.scheme_code} />
  );
}
