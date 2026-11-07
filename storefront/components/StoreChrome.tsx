"use client";

import { usePathname } from "next/navigation";

// Hides the store's announcement/header/footer on /hq, which is a full-screen board for projectors.
export default function StoreChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/hq" || path.startsWith("/hq/")) return null;
  return <>{children}</>;
}
