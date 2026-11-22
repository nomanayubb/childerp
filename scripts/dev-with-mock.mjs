// Runs the app on port 3100 pointed at the local mock FBR gateway (testing only).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-fbr.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
startMock(4010);
const next = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", "3100"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, FBR_BASE_URL: "http://127.0.0.1:4010" },
});
next.on("exit", (code) => process.exit(code ?? 0));
