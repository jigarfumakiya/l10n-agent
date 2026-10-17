import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { computeStatus } from "../src/core/status.js";
import type { BatchItem } from "../src/core/workflow.js";
import { extractJson, systemPrompt } from "../src/translate/prompt.js";
import { createCompletion, ProviderError, parseModel } from "../src/translate/providers.js";
import { modelFor, translateProject } from "../src/translate/translate.js";

const files = (config = "") =>
  memoryFs({
    "/p/localship.yaml": `locales: [hi, ar]\ntargets:\n  - format: android-xml\n    path: res\n${config}`,
    "/p/res/values/strings.xml": `<resources>
    <string name="save">Save</string>
    <string name="greeting">Hi %1$s</string>
    <plurals name="items"><item quantity="one">%d item</item><item quantity="other">%d items</item></plurals>
</resources>`,
  });

const FORMS: Record<string, string[]> = {
  hi: ["one", "other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
};

/** A fake model that translates by tagging, and drops the placeholder on a first try. */
function fakeModel(seen: string[]) {
  return () => async (req: { system: string; user: string }) => {
    seen.push(req.user);
    const items = JSON.parse(req.user.slice(req.user.indexOf("Items to translate:") + 19)) as Array<
      BatchItem & { rejected?: unknown }
    >;
    return `Here you go:\n\`\`\`json\n${JSON.stringify({
      translations: items.map((i) => ({
        target: i.target,
        locale: i.locale,
        key: i.key,
        value:
          i.kind === "plural"
            ? Object.fromEntries((FORMS[i.locale] ?? []).map((f) => [f, `[${i.locale}] %d`]))
            : i.key === "greeting" && !i.rejected
              ? `[${i.locale}] नमस्ते`
              : `[${i.locale}] ${i.source as string}`,
      })),
    })}\n\`\`\``;
  };
}

describe("translateProject", () => {
  it("splits large multibyte prompts without skipping entries", async () => {
    const fs = files();
    const source = "説明".repeat(700);
    fs.files.set(
      "/p/res/values/strings.xml",
      `<resources><string name="first">${source}</string><string name="second">${source}</string><string name="third">${source}</string></resources>`,
    );
    const sizes: number[] = [];
    const r = await translateProject(await openProject(fs, { cwd: "/p" }), {
      locales: ["hi"],
      model: "fake:model",
      maxPromptBytes: 10_000,
      concurrency: 2,
      completion: () => async (req) => {
        sizes.push(Buffer.byteLength(req.system) + Buffer.byteLength(req.user));
        const items = JSON.parse(
          req.user.slice(req.user.indexOf("Items to translate:") + 19),
        ) as BatchItem[];
        return JSON.stringify(items.map((item) => ({ ...item, value: "訳" })));
      },
    });
    expect(r.translated).toBe(3);
    expect(r.failed).toEqual([]);
    expect(sizes).toHaveLength(3);
    expect(sizes.every((size) => size <= 10_000)).toBe(true);
  });

  it("fails before contacting a model when one item or its context exceeds the byte budget", async () => {
    let calls = 0;
    await expect(
      translateProject(await openProject(files(), { cwd: "/p" }), {
        model: "fake:model",
        maxPromptBytes: Buffer.byteLength(systemPrompt()),
        completion: () => async () => {
          calls++;
          return "[]";
        },
      }),
    ).rejects.toThrow("exceeds maxPromptBytes");
    expect(calls).toBe(0);
  });

  it("counts retry feedback toward the prompt budget", async () => {
    const fs = files();
    let calls = 0;
    await expect(
      translateProject(await openProject(fs, { cwd: "/p" }), {
        model: "fake:model",
        locales: ["hi"],
        keys: ["greeting"],
        maxPromptBytes: 5000,
        completion: () => async () => {
          calls++;
          return JSON.stringify([{ locale: "hi", key: "greeting", value: "x".repeat(10_000) }]);
        },
      }),
    ).rejects.toThrow("exceeds maxPromptBytes");
    expect(calls).toBe(1);
    expect(fs.files.has("/p/res/values-hi/strings.xml")).toBe(false);
  });

  it("cancels retry waits without another call or writes", async () => {
    const fs = files();
    const controller = new AbortController();
    let calls = 0;
    const running = translateProject(await openProject(fs, { cwd: "/p" }), {
      model: "fake:model",
      locales: ["hi"],
      signal: controller.signal,
      completion: () => async () => {
        calls++;
        setTimeout(() => controller.abort(), 10);
        throw new ProviderError("rate limited", true);
      },
    });
    await expect(running).rejects.toThrow("cancelled");
    expect(calls).toBe(1);
    expect(fs.files.has("/p/res/values-hi/strings.xml")).toBe(false);
  });

  it("does not write a response that arrives after cancellation", async () => {
    const fs = files();
    const controller = new AbortController();
    await expect(
      translateProject(await openProject(fs, { cwd: "/p" }), {
        model: "fake:model",
        locales: ["hi"],
        keys: ["save"],
        signal: controller.signal,
        completion: () => async () => {
          controller.abort();
          return JSON.stringify([{ locale: "hi", key: "save", value: "सहेजें" }]);
        },
      }),
    ).rejects.toThrow("cancelled");
    expect(fs.files.has("/p/res/values-hi/strings.xml")).toBe(false);
  });

  it("does not store an old-source response against a source changed during the request", async () => {
    const fs = files();
    let calls = 0;
    const result = await translateProject(await openProject(fs, { cwd: "/p" }), {
      model: "fake:model",
      locales: ["hi"],
      keys: ["save"],
      completion: () => async () => {
        calls++;
        if (calls === 1) {
          fs.files.set(
            "/p/res/values/strings.xml",
            (await fs.readFile("/p/res/values/strings.xml")).replace(">Save<", ">Delete<"),
          );
        }
        return JSON.stringify([{ locale: "hi", key: "save", value: calls === 1 ? "सहेजें" : "हटाएं" }]);
      },
    });
    expect(calls).toBe(2);
    expect(result.translated).toBe(1);
    expect(await fs.readFile("/p/res/values-hi/strings.xml")).not.toContain("सहेजें");
    expect(await fs.readFile("/p/res/values-hi/strings.xml")).toContain("हटाएं");
  });

  it("reads source code once across batches and retries", async () => {
    const fs = files();
    const sourceFile = "/p/Main.kt";
    fs.files.set(sourceFile, "Button(onClick = {}) { Text(stringResource(R.string.save)) }");
    const readFile = fs.readFile;
    let codeReads = 0;
    fs.readFile = async (file) => {
      if (file === sourceFile) codeReads++;
      return readFile(file);
    };
    const r = await translateProject(await openProject(fs, { cwd: "/p" }), {
      model: "fake:model",
      batchSize: 1,
      completion: fakeModel([]),
    });
    expect(r.translated).toBe(6);
    expect(r.failed).toEqual([]);
    expect(codeReads).toBe(1);
  });

  it("finishes when requested states include the drafts it writes", async () => {
    const fs = files();
    const seen: string[] = [];
    const complete = fakeModel(seen)();
    const r = await translateProject(await openProject(fs, { cwd: "/p" }), {
      model: "fake:model",
      locales: ["hi"],
      keys: ["save", "greeting"],
      states: ["missing", "draft"],
      batchSize: 1,
      concurrency: 1,
      completion: () => async (req) => {
        if (seen.length >= 3) throw new Error("Already completed entries were selected again");
        return complete(req);
      },
    });
    expect(r.translated).toBe(2);
    expect(r.failed).toEqual([]);
    expect(seen).toHaveLength(3);
    expect(seen.filter((request) => request.includes('"key": "save"'))).toHaveLength(1);
  });

  it("translates every locale, retries rejected strings with their errors, and records drafts", async () => {
    const fs = files();
    const seen: string[] = [];
    const log: string[] = [];
    const r = await translateProject(await openProject(fs, { cwd: "/p" }), {
      model: "fake:model",
      completion: fakeModel(seen),
      log: (l) => log.push(l),
    });
    expect(r.translated).toBe(6);
    expect(r.failed).toEqual([]);
    expect(r.files).toEqual(["res/values-ar/strings.xml", "res/values-hi/strings.xml"]);
    // The retry carried the previous answer and the reason it was refused.
    const retry = seen.find((u) => u.includes('"rejected"'));
    expect(retry).toContain("Missing %1$s");
    const status = computeStatus(await openProject(fs, { cwd: "/p" }));
    expect(status.map((s) => [s.locale, s.counts.draft])).toEqual([
      ["hi", 3],
      ["ar", 3],
    ]);
    const lock = JSON.parse(fs.files.get("/p/.localship/lock.json") ?? "{}");
    expect(lock.targets.android.ar.items.model).toBe("fake:model");
  });

  it("gives up on a string after the allowed attempts", async () => {
    const fs = files();
    const stubborn = () => async (req: { user: string }) => {
      const items = JSON.parse(
        req.user.slice(req.user.indexOf("Items to translate:") + 19),
      ) as BatchItem[];
      return JSON.stringify(
        items.map((i) => ({ locale: i.locale, key: i.key, value: i.kind === "plural" ? {} : "x" })),
      );
    };
    const r = await translateProject(await openProject(fs, { cwd: "/p" }), {
      locales: ["hi"],
      model: "fake:model",
      completion: stubborn,
    });
    expect(r.translated).toBe(1);
    expect(r.failed.map((f) => [f.key, f.errors[0]?.slice(0, 20)])).toEqual([
      ["greeting", "Missing %1$s"],
      ["items", "Send every plural fo"],
    ]);
  });

  it("picks models per locale from the config", async () => {
    const p = await openProject(
      files("models:\n  default: openai:gpt-x\n  ar: anthropic:claude-x\n"),
      {
        cwd: "/p",
      },
    );
    expect(modelFor(p, "hi")).toBe("openai:gpt-x");
    expect(modelFor(p, "ar")).toBe("anthropic:claude-x");
    expect(modelFor(p, "ar-EG")).toBe("anthropic:claude-x");
    expect(modelFor(p, "ar", "ollama:qwen3:8b")).toBe("ollama:qwen3:8b");
    const bare = await openProject(files(), { cwd: "/p" });
    expect(() => modelFor(bare, "hi")).toThrow(/--model/);
  });
});

describe("providers", () => {
  const fakeFetch = (reply: unknown, calls: Array<{ url: string; init: RequestInit }>) =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;

  it("speaks the Anthropic Messages API", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const complete = createCompletion("anthropic:claude-sonnet-5-5", {
      env: { ANTHROPIC_API_KEY: "k" },
      fetch: fakeFetch({ content: [{ type: "text", text: "ok" }] }, calls),
    });
    expect(await complete({ system: "s", user: "u" })).toBe("ok");
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", system: "s" });
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.["x-api-key"]).toBe("k");
  });

  it("speaks OpenAI-compatible chat completions, locally without a key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const complete = createCompletion("ollama:qwen3:8b", {
      env: {},
      fetch: fakeFetch({ choices: [{ message: { content: "ok" } }] }, calls),
    });
    expect(await complete({ system: "s", user: "u" })).toBe("ok");
    expect(calls[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(JSON.parse(String(calls[0]?.init.body)).model).toBe("qwen3:8b");
  });

  it("uses providers from the config and explains missing keys", () => {
    expect(() => createCompletion("openai:gpt-x", { env: {} })).toThrow(/OPENAI_API_KEY/);
    expect(() => createCompletion("acme:m", { env: {} })).toThrow(/Unknown provider/);
    expect(() =>
      createCompletion("acme:m", { env: {}, custom: { acme: { baseUrl: "https://acme.dev/v1" } } }),
    ).not.toThrow();
    expect(() => parseModel("claude")).toThrow(/provider:model/);
  });
});

describe("extractJson", () => {
  it("reads fenced, bare and chatty replies", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });
});
