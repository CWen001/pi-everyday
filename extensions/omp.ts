import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOmpPathLinks } from "../src/path-links/register-omp.ts";

export default function piEverydayOmp(pi: ExtensionAPI): void {
  registerOmpPathLinks(pi);
}
