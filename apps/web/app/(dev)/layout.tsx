import type { ReactNode } from "react";
import { ThemeSwitcher } from "@/components/theme-provider";

/** Developer and operator tools: no player navigation, floating theme switch. */
export default function DevLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ThemeSwitcher floating />
    </>
  );
}
