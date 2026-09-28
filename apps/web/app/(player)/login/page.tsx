import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginPanel } from "@/components/auth/login-panel";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPanel />
    </Suspense>
  );
}
