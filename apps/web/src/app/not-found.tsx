import Link from "next/link";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-10">
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold text-text">404 - Page not found</h1>
        <p className="text-sm text-muted">
          This route does not exist. The link may be outdated or typed incorrectly.
        </p>
      </Card>
      <Card className="flex flex-wrap items-center gap-2">
        <Link href="/">
          <Button type="button" tone="blue">Back to Chat</Button>
        </Link>
        <Link href="/endpoints">
          <Button type="button" tone="neutral">Open Endpoints</Button>
        </Link>
      </Card>
    </div>
  );
}
