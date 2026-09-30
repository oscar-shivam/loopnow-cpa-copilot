import Link from "next/link";

import { ReviewClient } from "@/components/review/review-client";

export default function ReviewPage() {
  return (
    <main className="review-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">LOOPNOW · HUMAN REVIEW</p>
          <h1>Approval queue</h1>
        </div>
        <Link href="/dashboard" className="secondary-action">Back to workspace</Link>
      </header>
      <ReviewClient />
    </main>
  );
}
