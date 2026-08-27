import Link from "next/link";

export function AuthShell({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid place-items-center px-6 py-16">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="flex items-center justify-center gap-[9px] mb-7">
          <span className="w-[30px] h-[30px] rounded-[8px] bg-accent text-accent-ink grid place-items-center font-display font-extrabold text-[16px]">
            S
          </span>
          <b className="font-display text-[18px] font-bold tracking-[-0.02em]">SnapURL</b>
        </Link>

        <div className="bg-surface border border-line rounded-[14px] shadow-[var(--shadow-2)] p-6">
          <h1 className="text-[21px] font-bold mb-[6px]">{title}</h1>
          <p className="text-[13.5px] text-ink-2 mb-5 mt-0">{sub}</p>
          {children}
        </div>

        <p className="text-center text-[11.5px] text-ink-3 mt-4 leading-[1.6]">
          Your links keep redirecting even if you cancel.
          <br />
          We set no cookies and never sell click data.
        </p>
      </div>
    </div>
  );
}
