# blaze: the definitive guide

> **What this is.** A field guide to [indexable-inc/blaze](https://github.com/indexable-inc/blaze), "Rebuild Rust in milliseconds", with a hyperlink to the source behind every claim, followed by a review of the project.
>
> **Pinned to** commit [`7e40d50`](https://github.com/indexable-inc/blaze/commit/7e40d507832673dcc4f3d6eca9108188ed75b612) on `main` (2026-11-24, PR #2444). Every source link below is a permalink to that commit, so line numbers stay valid as the project moves. blaze changes daily, so check `main` before relying on any detail here.
>
> Licence of blaze: MIT or Apache-2.0 ([LICENSE-MIT](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/LICENSE-MIT), [LICENSE-APACHE](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/LICENSE-APACHE)). Written 2026-11-25.

---

## 1. What blaze is, in one paragraph

blaze is a Rust build system **and** compiler made by [ix](https://ix.dev). You type `blaze` where you would type `cargo`. It never runs `cargo` or `rustc`: it parses, type-checks, borrow-checks and generates code itself, using its own front end (forked from rust-analyzer), its own low-level IR (LIR), copy-and-patch "stencil" code for the dev loop, and a pinned LLVM for optimised code. Results are content-addressed records in one store, so an edit recompiles only the functions it changed. The stated product goal is **agents as the primary users**: an edit comes back as running code plus a structured result in tens of milliseconds ([plan.md, "Rules"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#rules)). It was called *ra-jit* until 2026-10-24 ([README, Credits](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#credits); [docs/rename.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/rename.md)).

## 2. Install

```sh
curl -fsSL https://ix.dev/blaze | sh                         # stable
curl -fsSL https://ix.dev/blaze | sh -s -- --channel canary  # newest build
```

Source: [README "Install"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#install), [docs/install.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/install.md), channels in [docs/release.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/release.md).

| Requirement | Detail | Source |
|---|---|---|
| OS | macOS on Apple silicon; Linux x86-64 or ARM64. **No Windows installer, no Intel Mac.** | [install.md "What you need"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/install.md#what-you-need), [platforms.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/platforms.md) |
| libc | glibc ≥ 2.34 (RHEL 9, Debian 12, Ubuntu 22.04+). musl/Alpine refused. | [install.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/install.md#what-you-need) |
| Linker | a C compiler: `gcc`/`cc` on Linux, Xcode CLT on macOS | same |
| Sandbox | Linux user namespaces or Landlock (5.13+). In locked-down containers use `--security-opt seccomp=unconfined` or `BLAZE_SANDBOX=off`. | same; [cargo.md "Build scripts and proc macros run in a sandbox"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#build-scripts-and-proc-macros-run-in-a-sandbox) |
| Memory | "a few GB for a small project and tens of GB for the largest" | [install.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/install.md#what-you-need), [memory-footprint.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/memory-footprint.md) |
| Rust | **Not needed.** blaze is its own toolchain: `nightly-2026-10-27` | [pins/toolchain](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/pins/toolchain), [docs/toolchain.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/toolchain.md) |

Other routes (crates.io, Nix flake): [docs/install.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/install.md), [flake.nix](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/flake.nix). Try the live-editable Game of Life demo with `nix run github:indexable-inc/blaze#life` ([demo/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/demo)).

## 3. Daily use

```sh
cd my-project
blaze check        # errors only, makes no code
blaze run -- args  # compile what main reaches and run it; writes no executable
blaze test         # run the tests a change can affect
blaze export       # write a standalone native executable
```

What the **current source** actually dispatches is the `match` in [crates/blaze-cli/src/main.rs#L660-L704](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L660-L704):

| Command | What it does | Handler |
|---|---|---|
| `check` (alias `engine-check`) | the execution engine's check; `--fix <selector>` applies fixes in one transaction | [L664](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L664) → [check_command.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/check_command.rs), [engine_check.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/engine_check.rs), [fix.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/fix.rs) |
| `run`, `test` | check, then run the program/tests from stored code records | [L674-L675](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L674-L675) → [engine_start.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/engine_start.rs) |
| `build` | **refused**: "`blaze run` compiles what the program reaches and runs it; `blaze export` writes the program as a standalone executable" | [L642](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L642), [L677](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L677) |
| `export` | whole-program native executable via blaze's own linker | [engine_export.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/engine_export.rs), [crates/blaze-export](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-export) |
| `why` | "why did this rerun", answered from recorded reads | [engine_why.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/engine_why.rs) |
| `explain`, `inspect`, `ci` | explain a rule; inspect records; CI mode | [inspect_command.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/inspect_command.rs), [ci_command.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/ci_command.rs) |
| `clean`, `gc` | remove checkout state (`--store` for the home store); bounded store compaction / LRU eviction | [clean.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/clean.rs), [gc.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/gc.rs) |
| `store`, `peer` | publish to / share the record store | [store/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/store), [peer.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/peer.rs) |
| `toolchain`, `warm-toolchain`, `--version` | print / pre-fetch the pinned toolchain | [L689-L700](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L689-L700) |
| `daemon` (hidden) | resident per-checkout daemon | [L688](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L688), [daemon_server.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/daemon_server.rs) |

Useful flags parsed in [main.rs#L479-L526](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L479-L526): `-p/--package`, `--bin`, `-o/--output`, `--view person|agent|json`, `--fix`, `--grant <param>=<scope>` (capability grants for blaze-edition programs, [host_grants.rs](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/host_grants.rs)), `--stats`, `--workers`, `--color`, `--origin/--origin-key` (shared cache).

The full cargo-compatibility reference, including `--goal edit|max` (wait for stencil code vs. fully optimised code), test selection flags (`--run-all`, `--ub`, `--ub-seed`), lock files and environment variables, is [docs/cargo.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md) (1,328 lines). Note the caveats in §7 about which of its commands exist in today's client.

**Plain `cargo build` does not go through blaze.** A leftover `RUSTC_WORKSPACE_WRAPPER` from an older `blaze enable` makes builds fail; remove it ([usage.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/usage.md#plain-cargo-build), [cargo.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#plain-cargo-switched-on-globally)).

**Lock file.** blaze writes [`blaze.lock`](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/blaze.lock) (release, toolchain, LLVM digests per target); commit it ([cargo.md "Lock files"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#lock-files)). Pin a blaze release per workspace with `[workspace.metadata.blaze] version = ...` ([Cargo.toml](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/Cargo.toml), [cargo.md "Pinning a release of blaze"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#pinning-a-release-of-blaze)).

## 4. How it works

The single idea, from [plan.md "The design"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#the-design): *a result is a pure function of content, keyed by the hash of exactly what it read, computed once on one scheduler, kept in one store.* The deep spec is [docs/v2/plan/design/bottom.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/bottom.md) (2,000+ lines; 152 design specs live in [docs/v2/plan/design/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design)).

### 4.1 The pipeline, crate by crate

```
 source tree (Merkle, content-addressed)
   │  blaze-lex ─ SIMD lexer, fn-body skipper
   │  parser / syntax ─ rust-analyzer's parser, flat syntax tree
   │  blaze-manifest · blaze-resolve · blaze-unit-graph ─ Cargo.toml, Cargo.lock, features/cfgs
   │  blaze-expand · blaze-proc-macro (wasm32-wasip1 in Wasmtime) · blaze-build-script (sandboxed)
   │  blaze-names-* ─ name resolution at item grain
   │  blaze-ty · blaze-typeck ─ types in columns, one body → one record
   │  blaze-borrow ─ borrow check
   │  blaze-body-lower ─ checked body → blaze-body MIR-like form
   ▼  blaze-lir ─ LIR: post-layout, post-ABI, post-drop-elaboration, columnar
      ├── stencils / blaze-emit ─ tier 0: copy-and-patch, one pass, no opt
      ├── LLVM (pinned) ─ optimised tier, hot functions re-patched in background
      └── wasm emitter
   ▼  blaze-launch · blaze-launcher ─ run code in-process, compiled on first call, no link
   ▼  blaze-export ─ release: own linker writes ELF / Mach-O / COFF
```

| Layer | Crate | Source |
|---|---|---|
| Lexing | blaze-lex: byte classes by nibble tables, rustc_lexer-exact tokens, body skipper, UTF-8 validation | [crates/blaze-lex](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-lex) |
| Parsing | parser, syntax (from rust-analyzer) | [crates/parser](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/parser), [crates/syntax](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/syntax), [flat-syntax.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/flat-syntax.md) |
| Cargo model | blaze-manifest, blaze-resolve ("cargo's resolver, owned by blaze"), blaze-unit-graph | [blaze-manifest](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-manifest), [blaze-resolve](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-resolve), [blaze-unit-graph](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-unit-graph), [resolve.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/resolve.md) |
| Macros | blaze-expand (pure fn of definition + tokens); proc macros as wasm modules | [blaze-expand](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-expand), [blaze-proc-macro](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-proc-macro), [proc-macros spec](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/proc-macros.md) |
| Build scripts | run sandboxed; their recorded reads are their cache key | [blaze-build-script](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-build-script), [blaze-comptime](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-comptime) |
| Types | blaze-ty (4-byte hash-consed type ids), blaze-typeck (one body in, one record out) | [blaze-ty](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-ty), [blaze-typeck](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-typeck) |
| Borrow check | blaze-borrow | [blaze-borrow](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-borrow), [borrowck.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/borrowck.md) |
| Constants | const evaluation | [blaze-consteval](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-consteval), [const.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/const.md) |
| Lowering | blaze-body-lower → LIR | [blaze-body-lower](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-body-lower), [blaze-lir](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-lir), [mir-passes.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/mir-passes.md) |
| Code gen | blaze-emit (baseline AArch64), tiers | [blaze-emit](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-emit), [blaze-tier](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-tier), [codegen spec](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/codegen.md) |
| Running | launcher: program runs in its own process, code mapped in on first call, edits patched live | [blaze-launch](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-launch), [launcher main.rs#L1-L21](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-launcher/src/main.rs#L1-L21), [launcher spec](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/launcher.md) |
| Release | whole-program export, own linker | [blaze-export](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-export), [no-rustc.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/no-rustc.md) |

### 4.2 The infrastructure underneath

| Concern | How | Source |
|---|---|---|
| Identity | BLAKE3 content IDs + dense `u32` indices; keys never include names or paths, so renames/moves/reformat compile nothing | [blaze-ids](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-ids), [plan.md §2](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#2-identity-is-content-never-a-name-or-a-place) |
| Engine | sans-IO execution engine: plan in phases, results merged by key, edits dirty forward | [blaze-engine](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-engine), [engine spec](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/engine.md) |
| Incrementality | session memo with single flight; DBSP-style delta engine | [blaze-memo](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-memo), [blaze-dbsp](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-dbsp) |
| Store | blaze-cas: immutable segment files under a two-slot head, lock-free reads | [blaze-cas](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cas), [store spec](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/store.md), [cache.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cache.md) |
| Remote cache | CI pushes store segments to R2/S3, signed and indexed; anyone pulls | [blaze-remote](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-remote), [remote-cache.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/remote-cache.md) |
| Scheduling | one work-stealing fiber pool, lock-free queues | [blaze-queue](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-queue), [plan.md §6](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#6-one-scheduler-one-memory-budget) |
| Std library | bstd: capability-based, no ambient IO, sans-IO, deterministic | [blaze-std](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-std), [std spec](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/std.md) |
| Diagnostics | everything is a `Report` (headline, rule, facts, fixes) rendered for terminal or agent | [blaze-report](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-report), [terminal.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/terminal.md) |
| Profiling | one span stream to Parquet; `ix-prof` (pprof-like) | [blaze-profile](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-profile), [ix-prof](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/ix-prof), [profiling.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/profiling.md), [ix-prof-format.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/ix-prof-format.md) |
| Testing itself | deterministic simulation, model checking, Lean proofs | [blaze-sim](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-sim), [lean/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/lean), [harness/v2](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/harness/v2), [harness.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/harness.md), [plan.md §11](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#11-proof-by-check-not-by-review) |

### 4.3 Its own toolchain, standard library and edition

* **Toolchain**: every project is built with the pinned nightly (`nightly-2026-10-27`), whatever `rust-toolchain.toml` says. Stable and `#![feature]` code both build. Rationale: [toolchain.md "Why one toolchain"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/toolchain.md#why-one-toolchain-and-why-blazes). The vendored std is in [library/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/library).
* **bstd**: `main` receives an `Io`; every function touches only what it is handed; there is no global heap, so OOM fails one task, not the process ([plan.md §13](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#13-its-own-standard-library)).
* **Edition `blaze-2026.11`**: Rust plus ten opt-in changes (error unions, view types, named args, contexts, effects, linear values, contracts, comptime reflection, `&uniq`), and removes lossy `as`, `async`, ambient IO, the global allocator and `static mut` ([plan.md §14](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#14-its-own-edition), [edition spec](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/design/edition.md), [language.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/language.md)).

## 5. Performance claims

From the [README "How fast"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#how-fast). The README itself says these are **v1 numbers; v2 has not been measured yet**.

| Edit one function, then build (Linux x86-64) | cargo build | blaze |
|---|---:|---:|
| ripgrep | 508 ms | 56 ms (9.1×) |
| nushell | 1.25 s | 236 ms (5.3×) |
| helix | 2.15 s | 116 ms (19×) |
| bun (1.25M lines) | 9.11 s | 451 ms (20×) |

Average edit-rebuild speed-ups: 10× macOS arm64, 24× Linux aarch64, 11× Linux x86-64; about 20 ms save-to-running with live edits. Methodology, machines and memory/disk cost: [docs/benchmarks.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/benchmarks.md), history in [docs/benchmarks/history](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/benchmarks/history), results in [docs/results.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/results.md).

## 6. Working on blaze itself

* Rules for contributors (human or agent): [AGENTS.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/AGENTS.md), generated from [tools/agents/rules.ts](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/tools/agents/rules.ts).
* Build, test, land: [docs/contributing.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/contributing.md), [justfile](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/justfile).
* What to work on: the objective ledger [docs/v2/plan/objectives.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/objectives.md) (data in [objectives.json](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/objectives.json)); invariants in [invariants.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/invariants.md); speed-of-light bounds in [bounds.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/bounds.md).
* Agent integrations shipped with the repo: [plugins/claude](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/plugins/claude), [plugins/codex](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/plugins/codex), [docs/agents.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/agents.md).
* Change log: [docs/CHANGELOG.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/CHANGELOG.md). Index of all docs: [docs/README.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/README.md).
* Scale at this commit: ~16,900 tracked files, ~190 crates under [crates/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates), a vendored std in [library/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/library), vendored deps in [vendor/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/vendor).

---

## 7. Review

### Verdict

blaze is one of the most ambitious Rust toolchain projects in public: a from-scratch, content-addressed compiler with live code patching, its own linker, std, edition and formal-methods ladder. The engineering discipline written into the repo (invariants collected by a script, planted-bug controls, a deterministic simulator, an objective ledger that decides "done" by running a check) is unusually rigorous. **But at this commit it is mid-rewrite (v1 → v2, merged 2026-11-01), and the user-facing docs have not caught up with the code.** Treat it as an experimental accelerator for the inner loop, not a cargo replacement, and keep `cargo check`/CI as the authority, exactly as its own README advises ([README "Good to know"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#good-to-know)).

### Strengths

1. **Sound core idea.** Content-keyed, item-grain records with name-free identity mean renames, moves and comments recompile nothing ([plan.md §2–3](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#2-identity-is-content-never-a-name-or-a-place)). Per-function codegen and no link step in the dev loop attack the real costs of Rust iteration.
2. **Verification culture.** Oracle tests for incremental-equals-clean, determinism checks by byte comparison, model checking, and Lean proofs ([plan.md §11](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#11-proof-by-check-not-by-review), [lean/](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/lean), [harness/v2](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/harness/v2)).
3. **Security posture for build code.** Build scripts and proc macros always sandboxed; proc macros run as wasm under Wasmtime ([cargo.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#build-scripts-and-proc-macros-run-in-a-sandbox), [blaze-proc-macro](https://github.com/indexable-inc/blaze/tree/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-proc-macro)). The `blaze` binary's crate root is `#![forbid(unsafe_code)]` ([main.rs#L21](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L21)).
4. **Honest about limits.** The README states v1-only benchmarks, memory cost, platform gaps and that cargo/CI stay the final word.
5. **Credits upstream** (rust-analyzer, Cranelift, LLVM, salsa, object, rustd, Makepad) clearly ([README "Credits"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#credits)).

### Problems found (documentation vs. code at `7e40d50`)

| # | Finding | Evidence |
|---|---|---|
| R1 | **`blaze build` is advertised but refused.** README "Try it" shows `blaze build` and the benchmark table's column is `blaze build`; the CLI returns `NoSuchCommand` for `build`. | [README#L48](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#L48), [README#L65](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#L65) vs. [main.rs#L677](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L677); [usage.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/usage.md) agrees with the code ("There is no `blaze build`") |
| R2 | **Daemon: three stories.** README and install.md describe "blaze's daemon, still running"; plan.md's *Settled* list says "No daemon: a command answers and exits"; the code still has a hidden `daemon` command and `check` takes a `spawn_daemon` flag. | [README#L52](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#L52), [README#L87](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#L87), [install.md#L18](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/install.md#L18) vs. [plan.md#L296](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md#L296) vs. [main.rs#L664](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L664), [main.rs#L688](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L688) |
| R3 | **Commands documented as working are not dispatched.** cargo.md's *Commands* block lists `bench`, `doc`, `fmt`, `new`, `init`, `tree`, `metadata`, `pin`, `agents`, `doctor` and `prove`. It does warn, 60 lines later, that the rest of the page describes the parked command line; but *Every subcommand* still says `fmt`, `new`, `init`, `tree` and `metadata` "are back" in `crates/blaze-cli`, and README says blaze "answers ... `bench`". The dispatcher's usage error lists only check, ci, inspect, run, test, export, peer, clean, gc, warm-toolchain and explain, and none of those five is matched. | [cargo.md#L73-L94](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#L73-L94), [cargo.md#L135-L138](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#L135-L138), [cargo.md#L1293-L1298](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/cargo.md#L1293-L1298), [README#L53](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#L53) vs. [main.rs#L660-L704](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L660-L704) |
| R4 | **`blaze toolchain` is assumed by the installer but v2 does not fetch.** install.md says the installer calls `blaze toolchain` "which v2 lacks"; the v2 `toolchain` command only prints the pin. | [install.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/install.md#what-you-need), [main.rs#L695-L699](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L695-L699) |
| R5 | **Broken doc pointers.** README links "a map of its crates", "CI runner" and "roadmap" all to plan.md, which has no crate map, CI-runner or roadmap section. | [README#L110-L112](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#L110-L112), [plan.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan.md) |
| R6 | **No current performance evidence.** All headline numbers are v1's; v2 is "not measured yet". Since v2 replaced the command set and architecture, the README's speed claims describe a different program from the one installed by `main`'s canary. | [README "How fast"](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/README.md#how-fast) |
| R7 | **Code still marked unwired** in the CLI (`#[allow(dead_code, reason = "... once the driver loop lands")]`), consistent with an in-progress rewrite. | [main.rs#L63-L64](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/crates/blaze-cli/src/main.rs#L63-L64) |

Caveat: the **stable** installer ships an earlier release (the repo itself pins `0.20261105.4` in [blaze.lock](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/blaze.lock)), which may still carry v1-era commands. R1–R3 describe the source at this commit, i.e. what the next releases are built from.

### Risks for adopters

* **Single toolchain pin.** Your code is compiled by blaze's nightly, not yours; a feature removed upstream fails under blaze ([toolchain.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/toolchain.md#what-it-means-for-a-project)).
* **Memory.** Several GB minimum; tens of GB on large projects ([memory-footprint.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/memory-footprint.md)).
* **Platforms.** No Windows release, no Intel Mac, no musl ([platforms.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/platforms.md)).
* **Bus factor and velocity.** Commits land daily, docs are partly generated and partly hand-written, and several design notes reference internal decision IDs (D97, D131, ...) only meaningful with [decisions.json](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/v2/plan/decisions.json).
* **Supply chain.** `curl | sh` install from `ix.dev`, binaries from an R2 bucket ([release.md](https://github.com/indexable-inc/blaze/blob/7e40d507832673dcc4f3d6eca9108188ed75b612/docs/release.md#where-the-bytes-are)). Read the script, or use the Nix flake / build from source for reproducibility.

### Recommendations

* **For users:** use `blaze check` / `blaze run` / `blaze test` for the inner loop; keep `cargo` for `build`, `bench`, publishing and CI; commit `blaze.lock` only if the team standardises on blaze.
* **For the blaze maintainers:** make README, install.md and cargo.md match the dispatcher (R1–R5); either delete `daemon_server.rs` or remove "No daemon" from *Settled*; publish one v2 benchmark run before keeping the speed table on the front page.

---

## 8. About the share link

The share link given with this request (`https://share.google/fbquMESnIoIowxJoL`) could not be opened from the build environment (`share.google` does not resolve there). The repository URL it was identified as, [github.com/indexable-inc/blaze](https://github.com/indexable-inc/blaze), is what this guide reviews. If the link pointed at a different page (an article or a search result about blaze), that page has not been reviewed here.
