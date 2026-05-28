import { AppHeader } from "@/app/_components/app-header";
import { Icon } from "@/app/_components/icon";

export const metadata = {
  title: "Friends — Dinner Spinner",
};

export default function FriendsPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Friends" />
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        <div className="mx-auto w-full max-w-2xl px-6 py-16 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-pill border border-rule bg-paper text-ink-3">
            <Icon name="users" size={28} />
          </div>
          <h1
            className="mt-5 text-[28px] font-medium leading-[1.05] tracking-[-0.02em] text-ink"
            style={{ fontFamily: "var(--font-disp)" }}
          >
            Friends
          </h1>
          <p className="mt-3 text-[14px] leading-snug text-ink-2">
            Coming soon. You&rsquo;ll be able to follow other cooks, see what
            they&rsquo;re making, and pull their public recipes into your own
            plan.
          </p>
        </div>
      </div>
    </div>
  );
}
