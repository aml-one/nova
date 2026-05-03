"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../components/ui/card";

/** Voice controls moved under Settings → Voice. */
export default function VoicePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?tab=voice");
  }, [router]);
  return (
    <Card className="p-4 text-sm text-muted">
      Redirecting to <strong className="text-text">Settings → Voice</strong>…
    </Card>
  );
}
