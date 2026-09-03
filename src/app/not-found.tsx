import Link from "next/link";
import { House } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="font-[family-name:var(--font-serif)] text-2xl font-bold">
        页面不存在
      </h1>
      <Link
        href="/"
        aria-label="返回首页"
        title="首页"
        className={cn(buttonVariants({ size: "icon-lg" }))}
      >
        <House />
      </Link>
    </div>
  );
}
