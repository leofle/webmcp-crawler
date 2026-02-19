# webmcp-crawler

CLI tool to detect whether a website serves a [WebMCP](https://webmcp.org) manifest at `/.well-known/webmcp.json`.

## Install

```bash
npm install -g webmcp-crawler
```

## Usage

```bash
webmcp-crawler <url>
```

### Examples

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

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | WebMCP manifest detected and valid |
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
