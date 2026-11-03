import Link from "next/link";
import { LoopStill } from "@/features/landing/loop-still";
import { Wordmark } from "@/components/ui/wordmark";

/**
 * S01/S02 frame (§4.3): form column on the page background, hero column on the inverse surface with the beat-0
 * still of the landing scene. No WebGL here (§6.2.8). Tablet: a 240 px band above the form; mobile: 160 px.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,480px)_1fr]">
      <div className="order-2 flex flex-col gap-10 gutter py-8 lg:order-1 lg:px-12">
        <Link href="/" aria-label="Dueloop home" className="w-fit rounded-sm">
          <Wordmark />
        </Link>
        <main id="main" className="grid w-full max-w-sm content-center gap-6 self-center lg:my-auto">
          {children}
        </main>
      </div>
      <div className="on-inverse relative order-1 flex h-40 flex-col items-center justify-center overflow-hidden bg-inverse md:h-60 lg:order-2 lg:h-auto">
        <LoopStill beat={0} priority className="h-full w-full object-contain p-4 lg:h-auto lg:max-h-[70vh] lg:p-12" />
        <p className="t-body-lg absolute bottom-8 hidden max-w-xs text-center text-ink-inverse lg:block">
          Polite reminders. Clear records. People in charge.
        </p>
      </div>
    </div>
  );
}
