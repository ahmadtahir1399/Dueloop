import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, CircleCheck, ChevronRight } from "lucide-react";
import { Wordmark } from "@/components/ui/wordmark";
import { COPY } from "@/features/landing/copy";
import { LandingHeader } from "@/features/landing/landing-header";
import { StoryWrapper } from "@/features/landing/story";
import { createClient } from "@/lib/supabase/server";

/**
 * S32 Landing page (§4.9). Signed-in visitors go to Overview (§10.2 item 7, the existing session check). Every
 * call to action is a link (no forms). Pricing is not rendered (Q18); legal links only if they exist (Q19: none).
 */
export default async function LandingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/overview");

  const hero = (
    <>
      <h1 className="t-display-2xl max-w-[16ch]">{COPY.h1}</h1>
      <p className="t-body-lg prose-width text-ink-inverse-muted">{COPY.sub}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Link href="/sign-up" className="press inline-flex min-h-13 items-center justify-center rounded-md bg-lime px-6 t-body-lg font-semibold text-on-lime hover:brightness-95">
          {COPY.primaryCta}
        </Link>
        <a href="#how" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 t-body-md font-semibold text-ink-inverse hover:underline">
          {COPY.secondaryCta}
          <ArrowDown aria-hidden="true" className="size-4" />
        </a>
      </div>
      <p className="flex items-start gap-2 t-body-sm text-ink-inverse-muted">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-lime" />
        {COPY.trust}
      </p>
    </>
  );

  return (
    <>
      <a href="#main" className="sr-only z-(--z-skip-link) rounded-md bg-panel px-4 py-3 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <LandingHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <StoryWrapper hero={hero} steps={COPY.steps} />

        <section aria-labelledby="promises-h" className="mx-auto max-w-(--content-max) gutter py-20">
          <h2 id="promises-h" className="sr-only">
            What Dueloop does
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {COPY.promises.map((p) => (
              <li key={p.title} className="reveal card-edge grid gap-2 rounded-xl border border-line bg-panel p-6">
                <h3 className="t-heading-md">{p.title}</h3>
                <p className="t-body-md text-ink-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="safety" aria-labelledby="safety-h" className="on-inverse bg-inverse py-20 text-ink-inverse">
          <div className="mx-auto grid max-w-(--content-max) gap-8 gutter">
            <div className="grid gap-2">
              <p className="t-label text-lime">Safety</p>
              <h2 id="safety-h" tabIndex={-1} className="t-display-lg max-w-[20ch]">
                {COPY.safetyH2}
              </h2>
            </div>
            <ul className="grid gap-4 md:grid-cols-3">
              {COPY.safety.map((s) => (
                <li key={s.title} className="reveal grid gap-2 rounded-xl bg-inverse-raised p-6">
                  <h3 className="t-heading-sm text-ink-inverse">{s.title}</h3>
                  <p className="t-body-sm text-ink-inverse-muted">{s.body}</p>
                </li>
              ))}
            </ul>
            <p className="t-body-sm text-ink-inverse-muted">{COPY.safetyInline.join(" · ")}</p>
          </div>
        </section>

        <section id="payments" aria-labelledby="payments-h" className="mx-auto grid max-w-(--content-max) grid-cols-1 items-center gap-10 gutter py-20 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-3">
            <p className="t-label text-brand">Payments</p>
            <h2 id="payments-h" tabIndex={-1} className="t-display-lg">
              {COPY.paymentsH2}
            </h2>
            <p className="t-body-lg prose-width text-ink-muted">{COPY.paymentsBody}</p>
          </div>
          <figure className="reveal card-edge grid gap-4 rounded-2xl border border-line bg-panel p-6 shadow-elev-2" aria-label="Example: every receipt balances">
            <p className="t-label">Every receipt balances</p>
            <div className="grid grid-cols-[auto_auto_auto_auto_auto] items-end justify-start gap-x-2 gap-y-1 tabular-nums sm:gap-x-3 [&>.fig]:t-heading-md sm:[&>.fig]:t-heading-lg">
              <span className="t-caption text-ink-muted">Received</span>
              <span />
              <span className="t-caption text-ink-muted">Applied</span>
              <span />
              <span className="t-caption text-ink-muted">Credit</span>
              <span className="fig">12,400.00</span>
              <span className="t-heading-md text-ink-muted">=</span>
              <span className="fig">12,400.00</span>
              <span className="t-heading-md text-ink-muted">+</span>
              <span className="fig">0.00</span>
            </div>
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 t-caption font-medium text-success-ink">
              <CircleCheck aria-hidden="true" className="size-3.5" /> Paid
            </span>
            <figcaption className="t-caption text-ink-muted">Illustration, not live data.</figcaption>
          </figure>
        </section>

        <section aria-labelledby="channels-h" className="border-y border-line bg-panel">
          <div className="mx-auto grid max-w-(--content-max) gap-8 gutter py-14 lg:grid-cols-2">
            <div className="grid content-start gap-3">
              <h2 id="channels-h" className="t-heading-lg">
                Channels and AI
              </h2>
              <ul className="flex flex-wrap gap-2">
                {COPY.channels.map((c) => (
                  <li key={c} className="rounded-full bg-brand-soft px-3 py-1.5 t-body-sm font-medium text-brand-soft-ink">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid content-start gap-3">
              <h2 className="t-heading-lg">Team roles</h2>
              <ul className="grid gap-2 t-body-md">
                {COPY.roles.map((r) => (
                  <li key={r.role}>
                    <span className="font-semibold">{r.role}:</span> <span className="text-ink-muted">{r.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-h" className="faq mx-auto grid max-w-3xl gap-6 gutter py-20">
          <h2 id="faq-h" tabIndex={-1} className="t-display-lg">
            Questions
          </h2>
          <div className="divide-y divide-line border-y border-line">
            {COPY.faq.map((f) => (
              <details key={f.q} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 t-heading-sm hover:text-brand">
                  <ChevronRight aria-hidden="true" className="faq-chevron size-4 shrink-0" />
                  {f.q}
                </summary>
                <p className="faq-answer pb-4 pl-7 t-body-md text-ink-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="cta-h" className="on-inverse bg-inverse text-ink-inverse">
          <div className="mx-auto flex max-w-(--content-max) flex-col items-start justify-between gap-6 gutter py-16 md:flex-row md:items-center">
            <h2 id="cta-h" className="t-display-lg max-w-[18ch]">
              {COPY.finalCta}
            </h2>
            <Link href="/sign-up" className="press inline-flex min-h-13 items-center rounded-md bg-lime px-6 t-body-lg font-semibold text-on-lime hover:brightness-95">
              {COPY.primaryCta}
            </Link>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-(--content-max) flex-wrap items-center justify-between gap-4 gutter py-8 t-body-sm text-ink-muted">
          <Wordmark />
          <nav aria-label="Footer">
            <ul className="flex gap-4">
              <li>
                <Link href="/sign-in" className="inline-flex min-h-11 items-center hover:underline">
                  Sign in
                </Link>
              </li>
              <li>
                <Link href="/sign-up" className="inline-flex min-h-11 items-center hover:underline">
                  Create account
                </Link>
              </li>
            </ul>
          </nav>
          <p>© {new Date().getFullYear()} Dueloop</p>
        </div>
      </footer>
    </>
  );
}
