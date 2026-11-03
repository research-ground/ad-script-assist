# AD Script Assist Agent Guidelines (GEMINI.md)

Welcome! As an AI development assistant (Gemini, Antigravity, Jetski, etc.) working on the **AD Script Assist** codebase, you must strictly adhere to the guidelines outlined in this document to maintain repository hygiene, avoid breaking existing configurations, and align with project practices.

---

## 1. Git & Branching Rules

### 🌿 Branch Workflow
1. **Primary Branch**: `main` is the primary development branch for the Lit web application (`src/web/`), CLI (`src/cli/`), and Node/Express server shim (`src/server.ts`).

---

## 2. Environment & Runtime Expectations

### 🖥️ Development Server
* AD Script Assist runs as a Vite + Lit web application paired with a lightweight Express server-side key & proxy shim (`src/server.ts`) at the repository root on port 3000 (`make start` / `npm start` / `npm run dev`).
* If the dev server is not running when executing browser tools or interactive checks, spin it up in the background (`make start`) rather than asking the developer to manually launch it.

### 🔑 API & Security Guidelines
* **Single Unified Config (`models.conf`)**: Active AI/TTS provider selections (`gemini`, `openai`, `kokoro`), model IDs (`gemini_model`, `openai_model`, `gemini_tts_model`, `openai_tts_model`), and API keys are configured in a single checked-in keyless `models.conf` file (no `.conf.example` files). Local key edits are kept out of commits with `git update-index --skip-worktree models.conf`.
* **Server-Side Key Isolation**: `models.conf` is read on the server by `src/server.ts`. Real API keys must never be exposed to the browser; `GET /api/config` replaces non-empty keys with `__SERVER_KEY:<name>__` placeholders, and `POST /api/proxy` substitutes real keys on the server.
* **Transparent Error Reporting**: Never obscure upstream API HTTP status codes or explanations (`503`, `429`, etc.), and never forward raw HTML error pages from `src/server.ts`.
* Avoid hardcoding any credentials or API keys in source files.

### 🤖 Gemini AI Model & Speech Defaults
* **Strict Model Selection**: Due to tightened API quotas, the default Gemini model is `gemini-3.5-flash-lite` (with local Kokoro `af_heart` as the default TTS voice, and `gemini-3.1-flash-tts-preview` when Cloud TTS is selected). Never proactively change the Gemini model configuration in `models.conf`, `src/core/constants.ts`, or code unless the user explicitly tells you which specific model to use and where to change it.

---

## 3. Mandatory Accessibility (a11y) Rules

### ♿ Mandatory Accessibility Check After Any UI Change
**CRITICAL RULE:** AD Script Assist is an Audio Description authoring tool whose users include blind, low-vision, screen-reader, and keyboard-only users. **Any UI change in `src/web/` or `index.html` MUST be followed by a thorough accessibility (a11y) check before considering the task complete:**

1. **Landmarks & Semantic Structure:**
   * Ensure regions (`<main>`, `<section>`, `role="toolbar"`, `role="log"`, `role="status"`) are properly labeled (`aria-label` or `aria-labelledby`) and never redundantly nested (e.g., do not place `role="main"` inside `<main>` or `role="region"` on a custom element host already wrapped in a labeled `<section>`).
   * Maintain a logical heading hierarchy (`<h1>`, `<h2>`, `<h3>`).

2. **Modal Dialogs (`<dialog>`):**
   * Always use native `<dialog>` opened via `.showModal()`.
   * Never set `role="dialog"` on a custom element host that stays mounted in the DOM when closed.
   * Every `<dialog>` MUST have `aria-labelledby` (and `aria-describedby` where applicable), a `@cancel` handler that syncs `Escape` dismissal with `appState`, and focus restoration back to the trigger element on close.
   * Trigger buttons that open dialogs must include `aria-haspopup="dialog"`.

3. **Icons, Labels & Form Controls:**
   * Every interactive control (`<button>`, `<input>`, `<select>`, `<textarea>`) MUST have an explicit programmatic label (`<label for="...">`, `aria-label`, or `aria-labelledby`).
   * All decorative icons (such as `<span class="material-icons">` or `&times;` close glyphs) MUST have `aria-hidden="true"` so screen readers do not read ligature strings aloud.
   * Validation errors and warnings must use `role="alert"` and be linked to their inputs via `aria-describedby` and `aria-invalid="true"`.
   * Dynamic status updates (e.g., speech generation progress/completion) must remain inside a persistent `role="status"` / `aria-live="polite"` container across state transitions.

4. **Keyboard Navigation & Focus Visibility:**
   * Every interactive element must be reachable and operable via keyboard (`Tab`, `Enter`/`Space`, `Escape`, and arrow keys for menus/splitters) and have a visible `:focus-visible` outline.
   * Run the accessibility and keyboard UI test suite after UI changes:
     ```bash
     npx tsx --test tests/e2e/accessibility.test.ts tests/ui/ui_panels_work.test.ts
     ```

### 📘 Accessible Documentation
* **Mandatory Alt Text & Accessible Descriptions**: All documentation (including `README.md` and files in `docs/`) must be accessible to screen reader users. Every image must have detailed, descriptive alt text (`![Detailed description...](path)`), and every block/ASCII/Mermaid diagram must include an accessible text description or `aria-label` summary explaining the components and data flow.

---

## 4. Code Style, Workspace Hygiene & Licensing

* **TypeScript & JavaScript Style Guide**: Follow the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) regarding naming, structure, and imports.
* **Apache 2.0 Copyright Header**: Every code file (`.ts`, `.html`, `.css`, `.scss`) must start with the standard Google Apache 2.0 license block (`Copyright 2026 Google LLC`). Verify this whenever creating new code files.
* **Keep It Clean**: Do not leave temporary, draft, or testing files at the root or in project directories after finishing a task. Use `<appDataDir>/brain/<conversation-id>/scratch/` if temporary storage is needed.
* **Comments & Docstrings**: Maintain documentation integrity. Preserve existing comments and docstrings unless they are explicitly incorrect or obsolete.

---

## 5. Local Setup & Testing Guidelines

### 🛠️ Setting Up The Repository
* **Automated Setup**: Run `make setup` (or `npm install`) to install Node.js packages at the repository root.
* **Configuration**: External AI/TTS providers, model versions, and API keys are configured on the server in `models.conf` (checked into git without keys; use `git update-index --skip-worktree models.conf` locally when adding personal keys).

### 🧪 Running Tests
Always run the local test suite when making changes to verify correctness:
* **UI & Accessibility Gate**: Run `npx tsx --test tests/e2e/accessibility.test.ts tests/ui/ui_panels_work.test.ts` after any UI modification.
* **Full Test Suite**: Run `npm test` to execute UI and CLI tests.
