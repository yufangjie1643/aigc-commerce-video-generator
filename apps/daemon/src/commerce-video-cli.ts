// @ts-nocheck
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDaemonUrl } from "./daemon-url.js";

const STRING_FLAGS = new Set([
  "daemon-url",
  "project",
  "title",
  "hook",
  "prompt",
  "prompt-file",
  "selling-points",
  "cta",
  "storyboard-json",
  "storyboard-file",
  "materials-json",
  "materials-file",
  "json-output",
  "model",
  "aspect",
  "length",
  "length-sec",
  "output",
  "since",
  "wait-timeout-ms"
]);

const BOOLEAN_FLAGS = new Set(["help", "h", "json", "follow", "full-auto"]);
const DEFAULT_COMMERCE_VIDEO_MODEL = "doubao-seedance-2-0-260128";

export async function runCommerceVideoCli(args: string[]): Promise<{ exitCode: number }> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h") || args[0] === "help") {
    printCommerceVideoHelp();
    return { exitCode: args.length === 0 ? 2 : 0 };
  }
  let flags: Record<string, any>;
  try {
    flags = parseFlags(args, { string: STRING_FLAGS, boolean: BOOLEAN_FLAGS });
  } catch (error: any) {
    console.error(error.message);
    printCommerceVideoHelp();
    return { exitCode: 2 };
  }

  const [command, first] = positionalArgs(args, STRING_FLAGS);
  const projectId = flags.project ?? first;
  const base = (await resolveDaemonUrl({ flagUrl: flags["daemon-url"] })).replace(/\/$/, "");

  try {
    switch (command) {
      case "workflow":
      case "status": {
        requireProject(projectId, "usage: od commerce-video workflow --project <id> [--json]");
        const data = await requestJson(base, `/api/projects/${encodeURIComponent(projectId)}/commerce-video/workflow`);
        return output(data, flags, printWorkflow);
      }
      case "materials": {
        requireProject(
          projectId,
          "usage: od commerce-video materials --project <id> (--materials-json <json>|--materials-file <path|->) [--json]"
        );
        const body = await readJsonBodyFromFlags(flags, "materials-json", "materials-file");
        const data = await requestJson(
          base,
          `/api/projects/${encodeURIComponent(projectId)}/commerce-video/materials`,
          {
            method: "POST",
            body
          }
        );
        return output(data, flags, printWorkflow);
      }
      case "script": {
        requireProject(
          projectId,
          "usage: od commerce-video script --project <id> --title <title> --hook <hook> --prompt <voiceover> [--json]"
        );
        const body = {
          title: flags.title,
          hook: flags.hook,
          voiceover: await readPromptFromFlags(flags),
          sellingPoints: splitList(flags["selling-points"]),
          ...(flags.cta ? { cta: flags.cta } : {})
        };
        const data = await requestJson(base, `/api/projects/${encodeURIComponent(projectId)}/commerce-video/script`, {
          method: "POST",
          body
        });
        return output(data, flags, printWorkflow);
      }
      case "storyboard": {
        requireProject(
          projectId,
          "usage: od commerce-video storyboard --project <id> (--storyboard-json <json>|--storyboard-file <path|->) [--json]"
        );
        const body = await readJsonBodyFromFlags(flags, "storyboard-json", "storyboard-file");
        const data = await requestJson(
          base,
          `/api/projects/${encodeURIComponent(projectId)}/commerce-video/storyboard`,
          {
            method: "POST",
            body
          }
        );
        return output(data, flags, printWorkflow);
      }
      case "generate": {
        requireProject(
          projectId,
          "usage: od commerce-video generate --project <id> [--model <id>] [--follow] [--json]"
        );
        if (flags.follow && !flags["full-auto"]) {
          console.error(
            "od commerce-video generate --follow requires --full-auto. Without explicit full automation, run `commerce-video jobs` / `commerce-video wait` in the separate 任务进度 stage."
          );
          return { exitCode: 2 };
        }
        const prompt = await readPromptFromFlags(flags);
        const body = {
          model: flags.model ?? DEFAULT_COMMERCE_VIDEO_MODEL,
          ...(flags.aspect ? { aspect: flags.aspect } : {}),
          ...(flags.output ? { output: flags.output } : {}),
          ...(flags.length || flags["length-sec"] ? { lengthSec: Number(flags.length ?? flags["length-sec"]) } : {}),
          ...(prompt ? { prompt } : {})
        };
        const data = await requestJson(base, `/api/projects/${encodeURIComponent(projectId)}/commerce-video/generate`, {
          method: "POST",
          body
        });
        if (flags.follow && data.taskId) {
          data.job = await waitForJob(base, data.taskId, flags);
          if (flags["full-auto"] && data.job?.status === "done") {
            data.previewResult = await requestJson(
              base,
              `/api/projects/${encodeURIComponent(projectId)}/commerce-video/preview`
            );
            data.exportResult = await requestJson(
              base,
              `/api/projects/${encodeURIComponent(projectId)}/commerce-video/export`,
              {
                method: "POST",
                body: {}
              }
            );
          }
        }
        return output(data, flags, (value) =>
          console.log(`[commerce-video] generation ${value.taskId ?? "-"} ${value.status ?? "-"}`)
        );
      }
      case "jobs": {
        requireProject(projectId, "usage: od commerce-video jobs --project <id> [--json]");
        const data = await requestJson(base, `/api/projects/${encodeURIComponent(projectId)}/commerce-video/jobs`);
        return output(data, flags, (value) => {
          for (const job of value.jobs ?? []) console.log(`${job.taskId}\t${job.status}\t${job.model ?? "-"}`);
        });
      }
      case "wait": {
        const jobId = first ?? projectId;
        if (!jobId) throw new Error("usage: od commerce-video wait <jobId> [--json]");
        const data = await requestJson(base, `/api/commerce-video/jobs/${encodeURIComponent(jobId)}/wait`, {
          method: "POST",
          body: { since: Number(flags.since ?? 0), timeoutMs: 25_000 }
        });
        return output(data, flags, (value) =>
          console.log(`[commerce-video] ${value.taskId ?? jobId} ${value.status ?? "-"}`)
        );
      }
      case "preview": {
        requireProject(projectId, "usage: od commerce-video preview --project <id> [--json]");
        const data = await requestJson(base, `/api/projects/${encodeURIComponent(projectId)}/commerce-video/preview`);
        return output(data, flags, (value) => console.log(value.preview?.path ?? value.export?.downloadPath ?? "-"));
      }
      case "export": {
        requireProject(projectId, "usage: od commerce-video export --project <id> [--json]");
        const data = await requestJson(base, `/api/projects/${encodeURIComponent(projectId)}/commerce-video/export`, {
          method: "POST",
          body: {}
        });
        return output(data, flags, (value) => console.log(value.export?.downloadPath ?? "-"));
      }
      default:
        throw new Error(`unknown subcommand: od commerce-video ${command ?? ""}`);
    }
  } catch (error: any) {
    console.error(error.message);
    return { exitCode: 1 };
  }
}

async function output(
  data: any,
  flags: Record<string, any>,
  print: (data: any) => void
): Promise<{ exitCode: number }> {
  if (typeof flags["json-output"] === "string" && flags["json-output"].length > 0) {
    await writeJsonFile(flags["json-output"], data);
    return { exitCode: 0 };
  }
  if (flags.json) writeJson(data);
  else print(data);
  return { exitCode: 0 };
}

function requireProject(projectId: string | undefined, message: string): asserts projectId is string {
  if (!projectId) throw new Error(message);
}

async function requestJson(base: string, route: string, init: { method?: string; body?: any } = {}) {
  const response = await fetch(`${base}${route}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`daemon ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function waitForJob(base: string, taskId: string, flags: Record<string, any>) {
  let since = Number.isFinite(Number(flags.since)) ? Number(flags.since) : 0;
  const startedAt = Date.now();
  const totalBudgetMs = waitTimeoutMs(flags);
  let lastData: any = null;
  do {
    const remaining = totalBudgetMs - (Date.now() - startedAt);
    const timeoutMs = Math.max(0, Math.min(25_000, remaining || 1));
    const data = await requestJson(base, `/api/commerce-video/jobs/${encodeURIComponent(taskId)}/wait`, {
      method: "POST",
      body: { since, timeoutMs }
    });
    lastData = data;
    since = data.nextSince ?? since;
    if (!flags.json && Array.isArray(data.progress)) {
      for (const line of data.progress) console.log(`[commerce-video] ${line}`);
    }
    if (data.status === "done" || data.status === "failed" || data.status === "interrupted") return data;
  } while (Date.now() - startedAt < totalBudgetMs);

  return {
    ...(lastData ?? {}),
    taskId,
    status: lastData?.status ?? "running",
    nextSince: since,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000),
    nextCommand: `"$OD_NODE_BIN" "$OD_BIN" commerce-video wait ${taskId} --since ${since}`
  };
}

function printWorkflow(data: any) {
  const workflow = data.workflow ?? data;
  console.log(`${workflow.projectId}\t${workflow.fileName}`);
  for (const stage of workflow.stages ?? []) console.log(`${stage.id}\t${stage.status}\t${stage.detail ?? ""}`);
}

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonFile(filePath: string, value: unknown) {
  const outputPath = path.resolve(filePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function waitTimeoutMs(flags: Record<string, any>): number {
  const raw = Number(flags["wait-timeout-ms"]);
  return Number.isFinite(raw) && raw >= 0 ? raw : 120_000;
}

function parseJson(value: string, flag: string) {
  try {
    return JSON.parse(value);
  } catch (error: any) {
    throw new Error(`${flag} must be valid JSON: ${error.message}`);
  }
}

function splitList(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

async function readPromptFromFlags(flags: Record<string, any>): Promise<string | undefined> {
  if (typeof flags.prompt === "string" && flags.prompt.length > 0) return flags.prompt;
  if (typeof flags["prompt-file"] !== "string" || flags["prompt-file"].length === 0) return undefined;
  if (flags["prompt-file"] === "-") return await readStdin();
  return await readFile(flags["prompt-file"], "utf8");
}

async function readJsonBodyFromFlags(
  flags: Record<string, any>,
  inlineFlag: string,
  fileFlag: string
): Promise<Record<string, unknown>> {
  const inlineValue = typeof flags[inlineFlag] === "string" ? flags[inlineFlag] : undefined;
  const fileValue = typeof flags[fileFlag] === "string" ? flags[fileFlag] : undefined;
  if (inlineValue && fileValue) throw new Error(`use either --${inlineFlag} or --${fileFlag}, not both`);
  if (fileValue) {
    const text = fileValue === "-" ? await readStdin() : await readFile(fileValue, "utf8");
    return parseJson(text, `--${fileFlag}`);
  }
  return inlineValue ? parseJson(inlineValue, `--${inlineFlag}`) : {};
}

async function readStdin(): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", reject);
  });
}

function positionalArgs(argv: string[], stringFlags = new Set<string>()): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value) continue;
    if (value.startsWith("--")) {
      const eq = value.indexOf("=");
      const key = eq >= 0 ? value.slice(2, eq) : value.slice(2);
      if (eq < 0 && stringFlags.has(key)) i++;
      continue;
    }
    out.push(value);
  }
  return out;
}

function parseFlags(argv: string[], opts: { string?: Set<string>; boolean?: Set<string> } = {}) {
  const out: Record<string, any> = {};
  const stringFlags = opts.string ?? new Set<string>();
  const booleanFlags = opts.boolean ?? new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw?.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    const key = eq >= 0 ? raw.slice(2, eq) : raw.slice(2);
    if (booleanFlags.has(key)) {
      out[key] = true;
      continue;
    }
    if (!stringFlags.has(key)) throw new Error(`unknown flag --${key}`);
    const value = eq >= 0 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

function printCommerceVideoHelp() {
  console.log(`Usage:
  od commerce-video workflow --project <id> [--json]
  od commerce-video materials --project <id> (--materials-json <json>|--materials-file <path|->) [--json]
  od commerce-video script --project <id> --title <title> --hook <hook> --prompt <voiceover> [--json]
  od commerce-video storyboard --project <id> (--storyboard-json <json>|--storyboard-file <path|->) [--json]
  od commerce-video generate --project <id> [--model <id>] [--json]
  od commerce-video generate --project <id> [--model <id>] --follow --full-auto [--wait-timeout-ms <ms>] [--json]
  od commerce-video jobs --project <id> [--json]
  od commerce-video wait <jobId> [--json]
  od commerce-video preview --project <id> [--json]
  od commerce-video export --project <id> [--json]

Common options:
  --daemon-url <url>       Open Design daemon HTTP base.
  --prompt-file <path|->   Long-form script or generation prompt input.
  --materials-file <path|->  Product material JSON for the project-local materials database.
  --storyboard-file <path|-> Storyboard JSON without shell quoting.
  --json-output <path>     Write JSON directly as UTF-8 instead of relying on shell redirection.`);
}
