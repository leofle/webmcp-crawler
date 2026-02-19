import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Inline WebMCP schema (from @toolindex/spec) ─────────────────────────────

const webmcpSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "WebMCP Manifest v0.1",
  type: "object",
  required: ["manifest_version", "origin", "updated_at", "tools"],
  additionalProperties: false,
  properties: {
    manifest_version: {
      type: "string",
      enum: ["0.1"],
    },
    origin: {
      type: "string",
      pattern: "^https?://",
    },
    updated_at: {
      type: "string",
      format: "date-time",
    },
    tools: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: [
          "name",
          "description",
          "version",
          "tags",
          "risk_level",
          "requires_user_confirm",
          "input_schema",
          "output_schema",
        ],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
          description: { type: "string", minLength: 1 },
          version: { type: "string", minLength: 1 },
          tags: { type: "array", items: { type: "string" } },
          risk_level: { type: "string", enum: ["low", "medium", "high"] },
          requires_user_confirm: { type: "boolean" },
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          pricing: {
            type: "object",
            required: ["model"],
            additionalProperties: false,
            properties: {
              model: {
                type: "string",
                enum: ["free", "per_call", "subscription"],
              },
              price_usd: { type: "number", minimum: 0 },
              notes: { type: "string" },
            },
          },
        },
      },
    },
    auth: {
      type: "object",
      required: ["requires_login"],
      additionalProperties: false,
      properties: {
        requires_login: { type: "boolean" },
        oauth_scopes: { type: "array", items: { type: "string" } },
      },
    },
    attestation: {
      type: "object",
      required: ["algo", "public_key_jwk", "signature", "signed_fields"],
      additionalProperties: false,
      properties: {
        algo: { type: "string", enum: ["ed25519"] },
        public_key_jwk: { type: "object" },
        signature: { type: "string" },
        signed_fields: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

interface CheckResult {
  url: string;
  detected: boolean;
  valid: boolean;
  version: string;
  toolCount: number;
  toolNames: string;
  error: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  const parsed = new URL(url);
  return parsed.origin;
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

function green(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

function red(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

// ── Validator (shared instance) ─────────────────────────────────────────────

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(webmcpSchema);

// ── Core check logic ────────────────────────────────────────────────────────

async function checkUrl(input: string): Promise<CheckResult> {
  let origin: string;
  try {
    origin = normalizeUrl(input);
  } catch {
    return {
      url: input,
      detected: false,
      valid: false,
      version: "",
      toolCount: 0,
      toolNames: "",
      error: "Invalid URL",
    };
  }

  const manifestUrl = `${origin}/.well-known/webmcp.json`;

  let response: Response;
  try {
    response = await fetch(manifestUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown network error";
    return {
      url: origin,
      detected: false,
      valid: false,
      version: "",
      toolCount: 0,
      toolNames: "",
      error: message,
    };
  }

  if (!response.ok) {
    return {
      url: origin,
      detected: false,
      valid: false,
      version: "",
      toolCount: 0,
      toolNames: "",
      error: `HTTP ${response.status}`,
    };
  }

  let manifest: unknown;
  try {
    manifest = await response.json();
  } catch {
    return {
      url: origin,
      detected: false,
      valid: false,
      version: "",
      toolCount: 0,
      toolNames: "",
      error: "Invalid JSON",
    };
  }

  const isValid = validate(manifest);

  if (!isValid) {
    const errors = validate.errors
      ?.map((e) => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    return {
      url: origin,
      detected: true,
      valid: false,
      version: "",
      toolCount: 0,
      toolNames: "",
      error: `Invalid manifest: ${errors}`,
    };
  }

  const m = manifest as {
    manifest_version: string;
    origin: string;
    tools: { name: string }[];
  };

  return {
    url: origin,
    detected: true,
    valid: true,
    version: m.manifest_version,
    toolCount: m.tools.length,
    toolNames: m.tools.map((t) => t.name).join("; "),
    error: "",
  };
}

// ── CSV helpers ─────────────────────────────────────────────────────────────

function parseCsvUrls(filePath: string): string[] {
  const content = readFileSync(resolve(filePath), "utf-8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim());

  // Skip header if it looks like one
  const first = lines[0]?.toLowerCase().trim();
  const start =
    first === "url" || first === "domain" || first === "website" ? 1 : 0;

  return lines.slice(start).map((line) => {
    // Take first column if CSV has multiple columns
    const col = line.split(",")[0].trim();
    // Strip surrounding quotes
    return col.replace(/^["']|["']$/g, "");
  });
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function resultsToCsv(results: CheckResult[]): string {
  const header = "url,detected,valid,version,tool_count,tool_names,error";
  const rows = results.map(
    (r) =>
      [
        escapeCsvField(r.url),
        r.detected,
        r.valid,
        escapeCsvField(r.version),
        r.toolCount,
        escapeCsvField(r.toolNames),
        escapeCsvField(r.error),
      ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

// ── Single URL mode ─────────────────────────────────────────────────────────

async function runSingle(input: string): Promise<void> {
  let origin: string;
  try {
    origin = normalizeUrl(input);
  } catch {
    console.error(red("✘") + ` Invalid URL: ${input}`);
    process.exit(1);
  }

  console.log(dim(`Checking ${origin}/.well-known/webmcp.json...\n`));

  const result = await checkUrl(input);

  if (!result.detected) {
    console.log(red("✘") + " WebMCP not detected");
    if (result.error) console.log(dim(`  ${result.error}`));
    process.exit(1);
  }

  if (!result.valid) {
    console.log(red("✘") + " WebMCP manifest found but invalid");
    if (result.error) console.log(dim(`  ${result.error}`));
    process.exit(1);
  }

  console.log(green("✔") + " WebMCP detected");
  console.log(`  Origin:   ${result.url}`);
  console.log(`  Version:  ${result.version}`);
  console.log(`  Tools:    ${result.toolCount}`);
  for (const name of result.toolNames.split("; ")) {
    console.log(`    - ${name}`);
  }

  process.exit(0);
}

// ── Batch CSV mode ──────────────────────────────────────────────────────────

async function runBatch(inputFile: string, outputFile: string): Promise<void> {
  let urls: string[];
  try {
    urls = parseCsvUrls(inputFile);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(red("✘") + ` Could not read CSV: ${msg}`);
    process.exit(1);
  }

  if (urls.length === 0) {
    console.error(red("✘") + " No URLs found in CSV");
    process.exit(1);
  }

  console.log(dim(`Processing ${urls.length} URLs...\n`));

  const results: CheckResult[] = [];
  let detected = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const progress = dim(`[${i + 1}/${urls.length}]`);

    const result = await checkUrl(url);
    results.push(result);

    if (result.detected && result.valid) {
      detected++;
      console.log(
        `${progress} ${green("✔")} ${result.url} — ${result.toolCount} tools`,
      );
    } else if (result.detected) {
      console.log(`${progress} ${red("✘")} ${result.url} — invalid manifest`);
    } else {
      console.log(`${progress} ${red("✘")} ${result.url}`);
    }
  }

  writeFileSync(resolve(outputFile), resultsToCsv(results));

  console.log(
    `\n${bold("Done.")} ${detected}/${urls.length} sites have WebMCP.`,
  );
  console.log(dim(`Results written to ${outputFile}`));

  process.exit(detected > 0 ? 0 : 1);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
${bold("webmcp-crawler")} — detect WebMCP manifests on websites

${bold("Usage:")}
  webmcp-crawler <url>
  webmcp-crawler --csv <input.csv> -o <output.csv>

${bold("Examples:")}
  webmcp-crawler https://example.com
  webmcp-crawler stripe.com
  webmcp-crawler --csv urls.csv -o results.csv

${bold("Options:")}
  --csv <file>   Input CSV file with URLs (one per line or first column)
  -o <file>      Output CSV file for results (default: results.csv)
  -h, --help     Show this help

${bold("What it does:")}
  Fetches <origin>/.well-known/webmcp.json and validates
  the manifest against the WebMCP v0.1 schema.

${bold("Exit codes:")}
  0  WebMCP manifest detected (at least one in batch mode)
  1  Not detected or invalid
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  // Check for CSV mode
  const csvIndex = args.indexOf("--csv");
  if (csvIndex !== -1) {
    const inputFile = args[csvIndex + 1];
    if (!inputFile) {
      console.error(red("✘") + " --csv requires a file path");
      process.exit(1);
    }

    const outIndex = args.indexOf("-o");
    const outputFile = outIndex !== -1 && args[outIndex + 1]
      ? args[outIndex + 1]
      : "results.csv";

    await runBatch(inputFile, outputFile);
    return;
  }

  // Single URL mode
  await runSingle(args[0]);
}

main();
