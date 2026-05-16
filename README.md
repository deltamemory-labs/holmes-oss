<p align="center">
  <img src="website/public/logo-t.png" alt="Holmes" width="96" />
</p>

<h1 align="center">Holmes</h1>

<p align="center">
  <strong>The legal AI that remembers everything your firm has ever done.</strong>
</p>

<p align="center">
  Local-first &nbsp;·&nbsp; Open source &nbsp;·&nbsp; Bring-your-own-key &nbsp;·&nbsp; Documents never leave your machine
</p>

<p align="center">
  <a href="#getting-started">Getting started</a> ·
  <a href="#development">Development</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-public%20beta-ff7759" />
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-17171c" />
  <img alt="platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-17171c" />
</p>

---

> **Public beta.** Holmes is under active development. Expect rough edges, breaking changes between 0.x releases, and missing pieces. File issues, open discussions, send PRs — that's the point of shipping in the open.

## What Holmes is

Holmes is a desktop app — built on Tauri — that turns every contract, brief, deposition, exhibit, and email your firm has ever touched into searchable, cross-matter memory. You install it, paste a Google Gemini API key, drag in a folder of documents, and ask.

Harvey, Legora, and CoCounsel sell legal AI to the top 100 firms on earth. Holmes is built for everyone else — solos, boutiques, in-house teams — who have the same document load and stricter privilege constraints, but no procurement department, no data-room negotiation, and no six-figure budget.

The design wedge is simple:

- **Memory that crosses matters.** Every other legal AI silos memory per project. Holmes runs an observational memory engine plus a semantic graph so "what did we negotiate three years ago on a different deal" actually surfaces.
- **Citations that hold.** Every factual claim ties to a document ID, a page, and a literal quote. Click the citation, land on the highlighted passage. No hallucinated cases. No invented quotes.
- **Local by construction.** The database, the documents, the memory store, and the vector index all live on the user's disk. The only bytes that leave are the prompts and embeddings the user chooses to send to the model provider — and the Ollama provider keeps everything air-gapped.

## Features

- **Chat over your matters** with verbatim citations and click-through to the source passage.
- **Tabular review at scale** — hundreds of documents, dozens of columns (governing law, CP deadlines, change-of-control thresholds, indemnity caps) extracted in parallel and exported to Excel.
- **Cross-matter memory** — an observational engine and semantic graph that index the terms, obligations, and edge cases discovered in every conversation.
- **Workflows library** — seeded prompt templates for Finance, Corporate, Litigation, Real estate; bring-your-own workflows via JSON.
- **Document formats** — PDF (incl. scans), DOCX, images, audio; processed through Gemini's multimodal pipeline.
- **Model providers** — Google Gemini today; Ollama for fully local inference (work in progress).
- **Secrets** — API keys stored in the OS keychain (macOS Keychain, Windows Credential Vault, Linux Secret Service) via [`keyring`](https://docs.rs/keyring).

## Screenshots

_Coming with the 0.2 release — the chat view, tabular review, and project dashboard._

## Getting started

### From a release

Installers will be published on the [Releases](https://github.com/deltamemory-labs/holmes/releases) page as soon as the first tagged build ships. The marketing site at [the public-beta website](website/) will link to `Holmes.dmg`, `Holmes-Setup.exe`, and `Holmes.AppImage` automatically.

### From source

```bash
# 1. Clone
git clone https://github.com/deltamemory-labs/holmes.git
cd holmes

# 2. Install JS deps (Bun is the project default; npm/pnpm also work)
bun install

# 3. Run the desktop app in dev mode (starts Vite + Tauri)
bun run tauri dev
```

To ship installers:

```bash
bun run tauri build
```

### Prerequisites

| Tool               | Minimum                                                      |
|--------------------|--------------------------------------------------------------|
| Node / Bun         | Bun ≥ 1.0 (or Node ≥ 20 with npm/pnpm)                       |
| Rust               | 1.77.2 (matches `rust-version` in `src-tauri/Cargo.toml`)    |
| Tauri system deps  | Follow the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS |

On macOS you'll need Xcode command-line tools. On Linux you'll need `libwebkit2gtk-4.1-dev` and the usual GTK build chain. Windows needs the Microsoft C++ Build Tools and WebView2 runtime.

### First run

1. Launch Holmes. The onboarding flow will prompt for a model API key.
2. Paste a Google Gemini key (the free tier is enough to evaluate).
3. Create a project, drag in a folder of documents, and start chatting.

## Development

### Project layout

```
.
├── src/                    React 19 + Vite 8 frontend (Tauri webview)
│   ├── pages/              Top-level route components (Chats, Projects,
│   │                       TabularReview, Workflows, Settings, …)
│   ├── components/         Shared UI (chat, tabular, shared, ui)
│   ├── lib/                Client-side helpers
│   └── routes.ts           @tanstack/react-router route tree
├── src-tauri/              Rust backend
│   ├── src/
│   │   ├── commands/       Tauri commands exposed to the frontend
│   │   ├── db/             SQLite schema + migrations (rusqlite, bundled)
│   │   ├── documents/      Extraction pipeline (pdf-extract, DOCX, etc.)
│   │   ├── memory/         Observational memory, reflector, semantic graph
│   │   ├── providers/      Model providers (gemini, ollama)
│   │   ├── search/         Hybrid search (BM25 + HNSW vector)
│   │   ├── tools/          Agent tools callable from chat
│   │   └── keystore.rs     OS keychain integration
│   ├── Cargo.toml
│   └── tauri.conf.json
├── website/                Next.js 16 marketing site (public beta)
├── pitch.md                Product pitch
├── product-vision.md       Product vision
├── design.md               Design system
├── arch.md                 Architecture notes
└── tasks.md                Active task list
```

### Scripts

Run from the repo root:

| Command                | What it does                                         |
|------------------------|------------------------------------------------------|
| `bun run dev`          | Vite dev server (frontend only, no Tauri shell)      |
| `bun run build`        | `tsc -b && vite build` — typecheck + frontend build  |
| `bun run preview`      | Vite preview of the built frontend                   |
| `bun run tauri dev`    | Desktop dev shell (recommended)                      |
| `bun run tauri build`  | Produce platform installers                          |

For the marketing site, `cd website && bun run dev`.

### Testing

Rust unit tests live next to the code they cover (see `src-tauri/src/db/tests.rs`). Run them with:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

A frontend test runner is not yet wired up — contributions welcome.

## Architecture

A single-process desktop app with a sharp frontend/backend split:

- **Frontend** — React 19 + Vite 8 + Tailwind 4 running in the Tauri webview. State and routing via `@tanstack/react-router`. Streaming model responses via the Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/react`).
- **Backend** — Rust. SQLite (bundled via `rusqlite`) holds projects, documents, chats, workflows, and memory observations. Vector search via [`hnsw_rs`](https://crates.io/crates/hnsw_rs). Lexical search via a BM25 index over the document chunks.
- **Document pipeline** — `pdf-extract` for PDFs, `zip` + `quick-xml` for DOCX, image/audio routed through the Gemini multimodal embedding endpoint.
- **Memory** — two layers. An **observational** layer runs after chats to distill obligations, terms, parties, and edge cases into typed observations. A **semantic graph** links observations across projects so cross-matter recall is a graph walk plus a vector hop, not a full re-index.
- **Secrets** — API keys never touch the SQLite file. They go through `keyring` to the native OS keychain.

Deeper notes in [`arch.md`](arch.md). Product thinking in [`pitch.md`](pitch.md) and [`product-vision.md`](product-vision.md).

## Privacy model

- Documents stay on disk. No background sync, no phone-home telemetry.
- The company that ships Holmes cannot leak what it never receives.
- Prompts and embeddings go to the model provider you configure (Gemini today, Ollama for fully local inference soon).
- Every citation resolves to a page and a literal quote — hallucinations are visibly wrong before they cause harm.

## Roadmap

- [x] Project + document ingestion (PDF, DOCX, image, audio)
- [x] Chat with citations, streamed from Gemini
- [x] Tabular review with Excel export
- [x] Workflows library (seeded + user-defined)
- [x] On-disk SQLite + HNSW + BM25 search
- [ ] Observational memory reflector (in progress)
- [ ] Ollama provider for fully air-gapped operation
- [ ] Code-signed installers on GitHub Releases
- [ ] Auto-update channel

## Contributing

Contributions are welcome — especially from lawyers who hit a workflow Holmes doesn't cover yet, and from engineers with taste for local-first desktop apps.

1. Open an issue describing the problem or the workflow you want to add.
2. For code: fork, branch, and open a PR against `main`. Run `bun run build` and `cargo test --manifest-path src-tauri/Cargo.toml` before pushing.
3. Keep the PR focused. Separate refactors from features.
4. Match the existing style. TypeScript on the frontend, idiomatic Rust with `thiserror` on the backend.

A formal `CONTRIBUTING.md` and issue templates will land shortly.

## License

Holmes is released under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPLv3+).

In plain English: you can read the code, run it, fork it, and modify it. If you redistribute Holmes — or run a modified version as a network service accessible to other users — you must release your modifications under the same license and make the corresponding source available to those users. That's the "SaaS clause" (Section 13) and it's deliberate: it keeps the commons honest.

If you want to build a closed-source commercial derivative or a hosted offering without complying with AGPLv3, get in touch — a separate commercial license can be arranged.

---

<p align="center">
  <sub>Built for the 500,000 lawyers enterprise AI doesn't call back.</sub>
</p>
