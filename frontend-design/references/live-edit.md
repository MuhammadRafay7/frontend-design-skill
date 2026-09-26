# Live edit mode

The user clicks an element in a live preview, types an instruction, and you apply exactly that change. Works with any agent that can run shell commands. Needs Node 18+, no installs.

`LE` below means `node <this skill's folder>/scripts/live-edit.mjs`. Run every command from the project root.

## 1. Start the preview

Pick the mode from the project:

| Project | Command |
| --- | --- |
| Has a dev server (Vite, Next.js, Astro, SvelteKit, Nuxt, CRA…) | Start the dev server first, then `LE start --target http://localhost:<dev port>` |
| Plain HTML/CSS/JS | `LE start` (serves the project folder; `--root <dir>` for a subfolder) |

- Run `start` as a **background / long-running process**. It prints the preview URL (default `http://localhost:4800`, change with `--port`).
- Tell the user to open that URL. In VS Code: Command Palette → **Simple Browser: Show** → paste the URL, and it opens in a side panel. Any browser works too.
- In the preview they press **Edit** (or Alt+Shift+E), click an element, type what should change, and press Send (Ctrl/Cmd+Enter).

## 2. Work loop

```
LE next            # waits for the next instruction (up to 90s), prints it
# ... apply the change ...
LE done <id> "one-line summary"      # or: LE fail <id> "reason"
LE next            # repeat
```

- `next` exits with code 3 and "No new instruction" on timeout. Just run it again. If your shell tool has a short timeout, pass `--timeout <seconds>` below it.
- `--json` prints the raw request if you prefer to parse it.
- `LE status` lists every instruction and its state. `LE stop` stops the server when the user is finished.
- If your environment can't keep a command waiting, tell the user to click through their changes, then say "apply edits". Run `LE next --timeout 1` repeatedly until it reports nothing new.

## 3. What a request contains

- **Instruction**: the user's words.
- **Source**: the file and line that render the clicked element. Marked `(approximate)` when only the file is known (e.g. Vue components). `unknown` means search using the selector, text, and HTML.
- **Rendered by**: the component chain, innermost first, with where each is used. When the element comes from a shared component (a `Button` in `components/ui`), decide from the instruction whether to change the shared component or only this usage. The default is **this usage only**. Change the shared component only when the instruction says so ("all buttons…").
- **Selector, Element text, HTML, Styles, Theme**: to confirm you found the right element and to see its current look.

## 4. Scope rules (strict)

1. Change only the code that renders the clicked element, and only what the instruction asks.
2. No drive-by fixes, reformatting, renames, or "while I'm here" improvements.
3. If the instruction is ambiguous, apply the most literal reasonable reading and note it in the `done` summary. Don't stop to ask unless it's truly impossible.
4. Keep the project's styling system (Tailwind classes stay Tailwind, CSS modules stay CSS modules). Follow the rest of this skill: tokens over hex, both themes.
5. In a git repo, check `git diff` before `done`. Only the intended lines should have changed.
6. Always close each request with `done` or `fail`. The user sees the result in the preview.

The preview reloads by itself: dev servers hot-reload, and static mode reloads when files change.

## Notes

- The server binds to 127.0.0.1 only. It rejects instructions from other origins and requires the token in `.live-edit/server.json` for `next`/`done`.
- State lives in `.live-edit/` in the project. It ignores itself in git.
- Unfinished requests (`working` when the server stopped) go back into the queue on the next `start`.
