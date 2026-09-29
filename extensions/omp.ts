import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOmpPathLinks } from "../src/path-links/register-omp.ts";
import { registerUsageStatus } from "../src/usage-status/register.ts";

export default function piEverydayOmp(pi: ExtensionAPI): void {
  try {
    registerUsageStatus(pi);
  } catch {
    // An optional convenience must never prevent OMP from starting.
  }

  registerOmpPathLinks(pi);
}
