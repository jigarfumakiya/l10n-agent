import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { memoryFs, nodeFs } from "../src/core/fs.js";
import { cldrPluralSpec } from "../src/core/plurals.js";
import { openProject } from "../src/core/project.js";
import { approve, prune, removeTranslations, submit } from "../src/core/workflow.js";
import { createServer } from "../src/mcp/server.js";
import { createCompletion } from "../src/translate/providers.js";

const config = "locales: [de]\ntargets:\n  - format: android-xml\n    path: res\n";
const source =
  '<resources><string name="save">Save</string><string name="open">Open</string></resources>';
const projectFs = () =>
  memoryFs({
    "/p/localship.yaml": config,
    "/p/res/values/strings.xml": source,
  });

describe("provider deadlines and cancellation", () => {
  it.each(["headers", "body"])("times out while waiting for %s", async (stage) => {
    let aborted = false;
    const fetch = (async (_url: string, init: RequestInit) => {
      const signal = init.signal;
      if (!signal) throw new Error("No cancellation signal");
      if (stage === "headers") {
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                controller.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
      );
    }) as typeof globalThis.fetch;
    const complete = createCompletion("ollama:test", { fetch, timeoutMs: 15 });
    await expect(complete({ system: "s", user: "u" })).rejects.toThrow("timed out after 15 ms");
    expect(aborted).toBe(true);
  });

  it("cancels an active request and does not dispatch an already cancelled one", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetch = (async (_url: string, init: RequestInit) => {
      calls++;
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        controller.abort();
      });
    }) as typeof globalThis.fetch;
    const complete = createCompletion("ollama:test", { fetch });
    const req = { system: "s", user: "u", signal: controller.signal };
    await expect(complete(req)).rejects.toThrow("cancelled");
    await expect(complete(req)).rejects.toThrow("cancelled");
    expect(calls).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
    "rejects invalid timeout %s",
    (timeoutMs) => {
      expect(() => createCompletion("ollama:test", { timeoutMs })).toThrow("timeoutMs");
    },
  );
});

describe("plural rule reuse", () => {
  it("does not leak caller or Apple zero-form mutations into later requests", () => {
    const original = cldrPluralSpec("en-GB");
    const copy = cldrPluralSpec("en-gb");
    expect(copy).toEqual(original);
    copy.source = "changed";
    const form = copy.forms[0];
    if (!form) throw new Error("No plural forms");
    form.examples = "changed";
    copy.forms.unshift({ id: "zero", examples: "0", optional: true, countImplied: true });
    expect(cldrPluralSpec("en-GB")).toEqual(original);
    expect(cldrPluralSpec("ar").forms.map((f) => f.id)).toEqual([
      "zero",
      "one",
      "two",
      "few",
      "many",
      "other",
    ]);
  });
});

describe("cooperative project writes", () => {
  it("reloads an old snapshot so unrelated submissions and lock records survive", async () => {
    const fs = projectFs();
    const first = await openProject(fs, { cwd: "/p" });
    const stale = await openProject(fs, { cwd: "/p" });
    await submit(first, [{ locale: "de", key: "save", value: "Speichern" }]);
    await submit(stale, [{ locale: "de", key: "open", value: "Öffnen" }]);
    const fresh = await openProject(fs, { cwd: "/p" });
    expect([...(fresh.targets[0]?.target.locales.get("de")?.entries.keys() ?? [])]).toEqual([
      "save",
      "open",
    ]);
    expect(Object.keys(fresh.lock.targets.android?.de ?? {})).toEqual(["open", "save"]);
  });

  it("checks the current approval state before replacing a stale snapshot", async () => {
    const fs = projectFs();
    const old = await openProject(fs, { cwd: "/p" });
    await submit(old, [{ locale: "de", key: "save", value: "Speichern" }]);
    await approve(old);
    const result = await submit(old, [{ locale: "de", key: "save", value: "Sichern" }]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]?.errors[0]?.code).toBe("state-approved");
  });

  it("rejects overlapping submit, approve, remove and prune operations; dry runs stay available", async () => {
    const fs = projectFs();
    const p = await openProject(fs, { cwd: "/p" });
    await fs.withLock("/p/.localship/write.lock", async () => {
      for (const operation of [
        () => submit(p, [{ locale: "de", key: "save", value: "Speichern" }]),
        () => approve(p),
        () => removeTranslations(p, { keys: ["save"] }),
        () => prune(p),
      ])
        await expect(operation()).rejects.toThrow("write is in progress");
      expect(
        (await submit(p, [{ locale: "de", key: "save", value: "Speichern" }], { dryRun: true }))
          .accepted,
      ).toHaveLength(1);
    });
    expect(fs.files.has("/p/res/values-de/strings.xml")).toBe(false);
    expect(
      (await submit(p, [{ locale: "de", key: "save", value: "Speichern" }])).accepted,
    ).toHaveLength(1);
  });

  it("releases the project lock when a write fails", async () => {
    const fs = projectFs();
    const p = await openProject(fs, { cwd: "/p" });
    const write = fs.writeFile;
    fs.writeFile = async () => {
      throw new Error("disk full");
    };
    await expect(submit(p, [{ locale: "de", key: "save", value: "Speichern" }])).rejects.toThrow(
      "disk full",
    );
    fs.writeFile = write;
    expect(
      (await submit(p, [{ locale: "de", key: "save", value: "Speichern" }])).accepted,
    ).toHaveLength(1);
  });

  it("excludes a separate Node process, cleans up locks and uses distinct temporary files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localship-lock-test-"));
    try {
      const lock = path.join(root, "write.lock");
      await nodeFs.withLock(lock, async () => {
        const { stdout } = await promisify(execFile)(process.execPath, [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `
          import { nodeFs } from './src/core/fs.ts';
          try { await nodeFs.withLock(process.argv[1], async () => { throw new Error('entered'); }); }
          catch (error) { console.log(error.message); }
        `,
          lock,
        ]);
        expect(stdout).toContain("write is in progress");
      });
      await expect(
        nodeFs.withLock(lock, async () => {
          throw new Error("failed");
        }),
      ).rejects.toThrow("failed");
      expect(await nodeFs.exists(lock)).toBe(false);
      const file = path.join(root, "output.txt");
      const values = Array.from({ length: 20 }, (_, i) => String(i).repeat(500));
      await Promise.all(values.map((value) => nodeFs.writeFile(file, value)));
      expect(values).toContain(await nodeFs.readFile(file));
      expect(await readdir(root)).toEqual(["output.txt"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("MCP request cancellation", () => {
  it("forwards client cancellation to an in-flight model request", async () => {
    const fs = projectFs();
    let startRequest = () => {};
    let cancelRequest = () => {};
    const started = new Promise<void>((resolve) => {
      startRequest = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      cancelRequest = resolve;
    });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      startRequest();
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            cancelRequest();
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    });
    const server = createServer({ cwd: "/p", version: "test", fs });
    const client = new Client({ name: "cancellation-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const controller = new AbortController();
      const pending = client.callTool(
        { name: "localship_translate", arguments: { model: "ollama:test", timeoutMs: 1000 } },
        undefined,
        { signal: controller.signal },
      );
      const rejected = expect(pending).rejects.toThrow();
      await started;
      controller.abort();
      await rejected;
      await cancelled;
      expect(fs.files.has("/p/res/values-de/strings.xml")).toBe(false);
    } finally {
      await client.close();
      await server.close();
      vi.unstubAllGlobals();
    }
  });
});
