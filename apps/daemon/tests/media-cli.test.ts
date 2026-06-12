import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("od media CLI", () => {
  it("lists registered media models by surface", () => {
    const cliPath = process.env.OD_DAEMON_CLI_PATH;
    expect(cliPath).toBeTruthy();

    const out = execFileSync(process.execPath, [cliPath!, "media", "models", "--surface", "video", "--json"], {
      encoding: "utf8"
    });
    const parsed = JSON.parse(out);

    expect(parsed.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "video",
          id: "doubao-seedance-2-0-260128",
          provider: "volcengine",
          default: true
        }),
        expect.objectContaining({
          surface: "video",
          id: "doubao-seedance-1.5-pro",
          provider: "volcengine"
        }),
        expect.objectContaining({
          surface: "video",
          id: "minimax-video-01",
          provider: "minimax",
          caps: expect.arrayContaining(["i2v"])
        }),
        expect.objectContaining({
          surface: "video",
          id: "hyperframes-html",
          provider: "hyperframes"
        })
      ])
    );

    const defaultVideoModels = parsed.models.filter((model: { default?: boolean }) => model.default === true);
    expect(defaultVideoModels.map((model: { id: string }) => model.id)).toEqual(["doubao-seedance-2-0-260128"]);
    expect(parsed.models.map((model: { id: string }) => model.id)).toContain("doubao-seedance-2-0-fast-260128");
  });

  it("writes media understanding JSON directly as UTF-8 for Chinese output", async () => {
    const cliPath = process.env.OD_DAEMON_CLI_PATH;
    expect(cliPath).toBeTruthy();
    const tempDir = mkdtempSync(path.join(tmpdir(), "od-media-cli-"));
    const imagePath = path.join(tempDir, "dress.jpg");
    const outputPath = path.join(tempDir, "understanding.json");
    writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/media/understand-image") {
        req.resume();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ content: "白色连衣裙", model: "mimo-v2.5", usage: { totalTokens: 12 } }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");

    try {
      const result = await execFileAsync(process.execPath, [
        cliPath!,
        "media",
        "understand",
        "--image",
        imagePath,
        "--daemon-url",
        `http://127.0.0.1:${address.port}`,
        "--json-output",
        outputPath
      ]);

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      const raw = readFileSync(outputPath);
      expect(raw.includes(Buffer.from("白色连衣裙", "utf8"))).toBe(true);
      expect(JSON.parse(raw.toString("utf8"))).toMatchObject({
        content: "白色连衣裙",
        model: "mimo-v2.5"
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
