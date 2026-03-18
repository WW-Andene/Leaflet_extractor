import { createReadStream, createWriteStream, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const publicDir = join(root, "public");
const chromiumBinDir = join(root, "node_modules", "@sparticuz", "chromium", "bin");

if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

if (existsSync(chromiumBinDir)) {
  console.log("Found chromium bin at:", chromiumBinDir);
  const tarPath = join(publicDir, "chromium-pack.tar");
  try {
    execSync(`tar -cf "${tarPath}" -C "${chromiumBinDir}" .`);
    console.log("Created chromium-pack.tar in public/");
  } catch (e) {
    console.error("Failed to create tar:", e.message);
  }
} else {
  console.log("Chromium bin dir not found at:", chromiumBinDir);
  console.log("This is OK for local dev - headless feature will use remote chromium");
}
