# webmcp-crawler

CLI tool to detect whether a website serves a [WebMCP](https://webmcp.org) manifest at `/.well-known/webmcp.json`.

## Install

```bash
npm install -g webmcp-crawler
```

## Usage

### Single URL

```bash
webmcp-crawler <url>
```

```bash
$ webmcp-crawler https://example.com
Checking https://example.com/.well-known/webmcp.json...

✔ WebMCP detected
  Origin:   https://example.com
  Version:  0.1
  Tools:    3
    - search_products
    - get_order
    - create_return

$ webmcp-crawler https://google.com
Checking https://google.com/.well-known/webmcp.json...

✘ WebMCP not detected
```

### Batch CSV

Check multiple URLs at once and get results as a CSV file.

```bash
webmcp-crawler --csv <input.csv> -o <output.csv>
```

The input CSV should have URLs in the first column. A header row (`url`, `domain`, or `website`) is automatically skipped if present.

```csv
url
https://stripe.com
https://github.com
https://example.com
```

```bash
$ webmcp-crawler --csv urls.csv -o results.csv
Processing 3 URLs...

[1/3] ✘ https://stripe.com
[2/3] ✘ https://github.com
[3/3] ✔ https://example.com — 3 tools

Done. 1/3 sites have WebMCP.
Results written to results.csv
```

The output CSV contains these columns:

| Column | Description |
|--------|-------------|
| `url` | Normalized origin URL |
| `detected` | Whether a manifest was found (`true`/`false`) |
| `valid` | Whether the manifest passes schema validation |
| `version` | Manifest version (e.g. `0.1`) |
| `tool_count` | Number of tools declared |
| `tool_names` | Semicolon-separated list of tool names |
| `error` | Error message if check failed |

If `-o` is omitted, results are written to `results.csv` by default.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | WebMCP detected (at least one in batch mode) |
| `1` | Not detected or invalid |

## Development

```bash
npm install
npm run build        # → dist/webmcp-crawler.js
npm run typecheck    # Type-check only
```

Requires Node.js 18+ (uses native `fetch`).

## License

MIT
