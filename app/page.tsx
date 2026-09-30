import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <section className="landing-panel" aria-labelledby="product-title">
        <p className="eyebrow">CANADIAN BOOKKEEPING · CONTROLLED AUTOMATION</p>
        <h1 id="product-title">Loopnow CPA Copilot</h1>
        <p className="landing-copy">
          A deterministic GST/HST and expense-processing workspace with AI-assisted
          interpretation, human review, and auditable decisions.
        </p>
        <Link className="primary-action" href="/dashboard">
          Open bookkeeping workspace
        </Link>
      </section>
    </main>
  );
}
