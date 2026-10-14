import { cliEnvironment } from "./supabase-env.mjs";
import { spawn, spawnSync } from "node:child_process";
import {
  readFileSync,
  openSync,
  closeSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const logPath = "/tmp/freezer-supabase-start.log";
const log = openSync(logPath, "w", 0o600);
const cli = spawn(
  "node_modules/.bin/supabase",
  [
    "start",
    "--exclude",
    "studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime",
  ],
  {
    stdio: ["ignore", log, log],
    env: {
      ...cliEnvironment,
      SUPABASE_USE_SLIM_IMAGES: "true",
      SUPABASE_INTERNAL_IMAGE_REGISTRY: "ghcr.io",
    },
  },
);
const done = new Promise((resolve) => cli.on("close", resolve));
let exited = false;
done.then(() => {
  exited = true;
});
const wrapper = readFileSync(
  new URL("./local-health-wget.sh", import.meta.url),
  "utf8",
);
const deadline = Date.now() + 180000;
while (!exited && Date.now() < deadline) {
  for (const [container, endpoint] of [
    ["supabase_auth_freezerOS", "http://127.0.0.1:9999/health"],
    ["supabase_storage_freezerOS", "http://127.0.0.1:5000/status"],
  ]) {
    const probe = spawnSync(
      "docker",
      ["inspect", "--format", "{{json .State.Health}}", container],
      { encoding: "utf8" },
    );
    if (probe.status !== 0) continue;
    const health = JSON.parse(probe.stdout);
    if (!health?.Log?.some((entry) => entry.Output?.includes("403 Forbidden")))
      continue;
    const direct = spawnSync(
      "docker",
      ["exec", container, "/usr/bin/wget", "-Y", "off", "-qO-", endpoint],
      { encoding: "utf8" },
    );
    if (direct.status !== 0) continue;
    if (
      endpoint.endsWith("/health") &&
      JSON.parse(direct.stdout).name !== "GoTrue"
    )
      continue;
    const tmp = mkdtempSync("/tmp/freezer-health-");
    try {
      const existing = spawnSync(
        "docker",
        ["cp", container + ":/usr/local/bin/wget", tmp + "/wget"],
        { encoding: "utf8" },
      );
      if (existing.status === 0) {
        if (readFileSync(tmp + "/wget", "utf8") !== wrapper)
          throw new Error(
            "Existing wget helper differs; refusing to overwrite it.",
          );
        continue;
      }
      const directory = container.includes("storage")
        ? spawnSync(
            "docker",
            ["exec", "-u", "0", container, "mkdir", "-p", "/usr/local/bin"],
            { encoding: "utf8" },
          )
        : { status: 0 };
      if (directory.status !== 0)
        throw new Error("Local health-check directory creation failed.");
      const fix = spawnSync(
        "docker",
        [
          "cp",
          "scripts/local-health-wget.sh",
          container + ":/usr/local/bin/wget",
        ],
        { encoding: "utf8" },
      );
      if (fix.status !== 0)
        throw new Error("Local health-check correction failed.");
      console.log(
        "Corrected proxy routing for a loopback health check: " + container,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  await delay(1000);
}
const code = await done;
closeSync(log);
if (code !== 0) {
  console.error(
    "Supabase startup failed. Inspect " +
      logPath +
      " privately; it may contain local credentials.",
  );
  process.exitCode = Number(code) || 1;
} else {
  const response = await fetch("http://127.0.0.1:54321/auth/v1/health");
  if (!response.ok || (await response.json()).name !== "GoTrue")
    throw new Error("Auth readiness check failed");
  console.log("Local Supabase API is ready.");
}
