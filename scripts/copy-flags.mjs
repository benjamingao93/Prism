// Copy the SVG flags from country-flag-icons (MIT) into public/flags so pages can load them as
// plain images. Runs before dev and build; the output is git-ignored.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const src = "node_modules/country-flag-icons/3x2";
const dest = "public/flags";
if (!existsSync(src)) {
  console.warn("[flags] country-flag-icons is not installed; skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[flags] copied ${readdirSync(dest).length} flags to ${dest}`);
