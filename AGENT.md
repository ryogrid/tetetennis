## Code Navigation — which tool for which layer (IMPORTANT)

This repo has two layers, each with its own navigation tool:

- **MoonBit logic layer (`logic/`, `.mbt`):** use `moon ide` / `moon doc`
  (see below). Serena does **not** support MoonBit, so do not point its symbol
  tools at `.mbt` files.
- **JavaScript render/sound layer (`src/`, `.js`):** use the **Serena** MCP
  server's symbol tools (`find_symbol`, `find_referencing_symbols`,
  `replace_symbol_body`, etc.) instead of grep/Read. Serena is configured
  project-locally via `.mcp.json` (`language: typescript` in
  `.serena/project.yml`). Run `/mcp` to confirm it is connected.

## Coding Convention of MoonBit

- Each block is separated by `///|`
- MoonBit code uses snake_case for variables/functions (lowercase only)

## Code Navigation of MoonBit (IMPORTANT)

**Always use `moon ide` and `moon doc` instead of grep/Read for code exploration.**

### `moon ide` - Semantic Code Navigation

```bash
# Show symbol definition with source code
moon ide peek-def fib
moon ide peek-def Type::method

# List symbols in a file
moon ide outline src/lib.mbt

# Rename symbol (refactoring)
moon ide rename old_name new_name
```

### `moon doc` - Standard Library API Discovery

```bash
moon doc 'String'         # List String methods
moon doc 'Array'          # List Array methods
moon doc '@json'          # List symbols in package
moon doc 'String::*rev*'  # Glob pattern search
```

