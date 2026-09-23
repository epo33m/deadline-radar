import type { ReactNode } from "react";

type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
};

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="relative left-1/2 w-screen -translate-x-1/2 -mt-5 border-b border-hairline bg-canvas-parchment px-4 py-10 text-center sm:-mt-6 sm:py-12 lg:-mt-8">
      <h1 className="font-display text-[42px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[46px] lg:text-[58px]">
        {title}
      </h1>
      {subtitle ? (
        <p className="mx-auto mt-2 max-w-xl text-[15px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-64 sm:text-[17px]">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}