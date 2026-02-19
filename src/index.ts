import Ajv from "ajv";
import addFormats from "ajv-formats";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  // Parse and reconstruct to get just the origin
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
${bold("webmcp-crawler")} — detect WebMCP manifests on websites

${bold("Usage:")}
  webmcp-crawler <url>

${bold("Examples:")}
  webmcp-crawler https://example.com
  webmcp-crawler stripe.com

${bold("What it does:")}
  Fetches <origin>/.well-known/webmcp.json and validates
  the manifest against the WebMCP v0.1 schema.

${bold("Exit codes:")}
  0  WebMCP manifest detected and valid
  1  Not detected or invalid
`);
    process.exit(args.length === 0 ? 1 : 0);
  }

  let origin: string;
  try {
    origin = normalizeUrl(args[0]);
  } catch {
    console.error(red("✘") + ` Invalid URL: ${args[0]}`);
    process.exit(1);
  }

  const manifestUrl = `${origin}/.well-known/webmcp.json`;
  console.log(dim(`Checking ${manifestUrl}...\n`));

  // Fetch manifest
  let response: Response;
  try {
    response = await fetch(manifestUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown network error";
    console.log(red("✘") + " WebMCP not detected");
    console.log(dim(`  Error: ${message}`));
    process.exit(1);
  }

  if (!response.ok) {
    console.log(red("✘") + " WebMCP not detected");
    console.log(dim(`  HTTP ${response.status} ${response.statusText}`));
    process.exit(1);
  }

  // Parse JSON
  let manifest: unknown;
  try {
    manifest = await response.json();
  } catch {
    console.log(red("✘") + " WebMCP not detected");
    console.log(dim("  Response was not valid JSON"));
    process.exit(1);
  }

  // Validate against schema
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(webmcpSchema);
  const valid = validate(manifest);

  if (!valid) {
    console.log(red("✘") + " WebMCP manifest found but invalid");
    if (validate.errors) {
      for (const err of validate.errors) {
        console.log(dim(`  ${err.instancePath || "/"} ${err.message}`));
      }
    }
    process.exit(1);
  }

  // Valid manifest — display results
  const m = manifest as {
    manifest_version: string;
    origin: string;
    tools: { name: string }[];
  };

  console.log(green("✔") + " WebMCP detected");
  console.log(`  Origin:   ${m.origin}`);
  console.log(`  Version:  ${m.manifest_version}`);
  console.log(`  Tools:    ${m.tools.length}`);
  for (const tool of m.tools) {
    console.log(`    - ${tool.name}`);
  }

  process.exit(0);
}

main();
