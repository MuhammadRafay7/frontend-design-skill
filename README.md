# frontend-design skill

A design skill for coding agents: distinctive, production-grade UI with first-class light **and** dark themes. It avoids generic AI aesthetics, and it includes **live edit mode**, where you click elements in a live preview and tell the agent what to change.

Works with any agent that reads `SKILL.md` skills or can be pointed at a file (Claude Code, Codex, Cursor, Copilot, Gemini CLI, and others).

## Install

Copy the `frontend-design/` folder into your agent's skills directory:

| Agent | Location |
| --- | --- |
| Claude Code | `~/.claude/skills/` (all projects) or `.claude/skills/` (one project) |
| Other skill-aware agents | That agent's skills folder (see its docs) |
| Agents without skill support | Put the folder in your repo and add to `AGENTS.md` (or the agent's rules file): *"For UI work, follow `frontend-design/SKILL.md`."* |

## Live edit mode

Requires Node 18+. Nothing to install.

1. Ask your agent for live edit mode (e.g. *"start live edit on my dev server"*). The agent runs:
   ```
   node frontend-design/scripts/live-edit.mjs start --target http://localhost:5173
   ```
   For plain HTML, the agent leaves out `--target`.
2. Open the printed URL (default `http://localhost:4800`). In VS Code: Command Palette → **Simple Browser: Show** → paste the URL, and the preview opens beside your code.
3. Press **Edit** (Alt+Shift+E), click an element, type the change, and send it (Ctrl/Cmd+Enter).
4. The agent receives it with `live-edit.mjs next`, changes only that element's code, and reports back. You see "Applied: …" in the preview, and the page hot-reloads.

How clicks map to code:

| Stack | Maps to |
| --- | --- |
| Plain HTML | exact file and line |
| React 18/19 (Vite, Next.js incl. Server Components, Turbopack) | exact file and line, plus the component chain |
| Vue | component file |
| Anything else | CSS selector, text, and HTML for the agent to search |

Agent protocol and scope rules: [`frontend-design/references/live-edit.md`](frontend-design/references/live-edit.md).

## Contents

```
frontend-design/
  SKILL.md                 main design rules
  references/theming.md    light + dark implementation
  references/motion.md     motion system and spring physics
  references/anti-patterns.md
  references/live-edit.md  live edit protocol
  scripts/live-edit.mjs    preview server + agent CLI (zero dependencies)
  scripts/overlay.js       in-page click-to-select UI
```
