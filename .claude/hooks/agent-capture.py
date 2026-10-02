#!/usr/bin/env python3
"""Agent capture hook for the 8x assignment.

Wired to the UserPromptSubmit and Stop events in .claude/settings.json. On every
event it reads the Claude Code session transcript named in the hook input and
rewrites .agent-logs/<first-prompt-time>_<session-id>.md from it, so the log is
always a pure function of the transcript. Nothing is hand-edited.

What is logged, per exchange: the prompt verbatim, the final response of that
exchange, a UTC timestamp and the model. Thinking, tool calls, tool results and
mid-turn progress notes are left out.

One addition to "prompt and final response": when the agent stops to ask the
user a question through Claude Code's question prompt, the text and question the
user saw are logged as a RESPONSE and the user's answer as the next PROMPT.
Otherwise those decisions would be missing from the record.

A message the user sends while a turn is still running is logged as its own
PROMPT. The turn's final response is logged once, under the last prompt of that
turn. Reports from sub-agents are not prompts and are not logged.
"""
import glob
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

LOG_DIR_NAME = ".agent-logs"
TOOL = "claude-code"
# User-role transcript entries that are harness output, not something the user asked.
NON_PROMPT_PREFIXES = (
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<local-command-caveat>",
    "<bash-input>",
    "<bash-stdout>",
    "<bash-stderr>",
    "<task-notification>",
    "<system-reminder>",
    "<agent-message",
)


def now_utc():
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (now.microsecond // 1000)


def read_transcript(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue  # a line still being written
    return rows


def user_text(content):
    """Text of a user message, or None if it carries tool results."""
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        kind = block.get("type")
        if kind == "tool_result":
            return None
        if kind == "text":
            parts.append(block.get("text", ""))
        elif kind == "image":
            parts.append("[image attached]")
    return "\n".join(parts)


def is_human_prompt(row, text):
    if row.get("isMeta") or row.get("isSidechain") or row.get("isCompactSummary"):
        return False
    if row.get("sourceToolUseID"):
        return False
    origin = row.get("origin")
    if isinstance(origin, dict) and origin.get("kind") not in (None, "human"):
        return False
    if text is None or not text.strip():
        return False
    return not text.lstrip().startswith(NON_PROMPT_PREFIXES)


def render_questions(questions):
    lines = ["[Question put to the user through Claude Code's question prompt]"]
    for q in questions or []:
        lines.append("")
        lines.append(q.get("question", ""))
        for opt in q.get("options") or []:
            label = opt.get("label", "")
            desc = opt.get("description", "")
            lines.append("- " + label + (": " + desc if desc else ""))
    return "\n".join(lines)


def render_answers(result):
    lines = ["[Answer given through Claude Code's question prompt]"]
    answers = result.get("answers") or {}
    for question, answer in answers.items():
        lines.append("")
        lines.append("Q: " + str(question))
        lines.append("A: " + str(answer))
        note = ((result.get("annotations") or {}).get(question) or {}).get("notes")
        if note:
            lines.append("Note: " + str(note))
    return "\n".join(lines)


def build_exchanges(rows):
    """Turn transcript rows into [{prompt, prompt_ts, response, response_ts, model}]."""
    exchanges = []
    current = None
    texts_since_tool = []  # assistant text after the most recent tool result
    last_text = None  # most recent assistant text in this exchange
    last_model = None

    def close(extra=None):
        if current is None:
            return
        chosen = texts_since_tool or ([last_text] if last_text else [])
        body = "\n\n".join(t["text"] for t in chosen).strip()
        if extra:
            body = (body + "\n\n" + extra).strip() if body else extra
        if body:
            current["response"] = body
            current["response_ts"] = (chosen[-1]["ts"] if chosen else None) or current.get("ask_ts")
        if current.get("model") is None:
            current["model"] = last_model

    for row in rows:
        kind = row.get("type")
        if kind == "assistant" and not row.get("isSidechain"):
            message = row.get("message") or {}
            last_model = message.get("model") or last_model
            if current is None:
                continue
            current["model"] = message.get("model") or current.get("model")
            for block in message.get("content") or []:
                if block.get("type") == "text" and block.get("text", "").strip():
                    entry = {"text": block["text"].strip(), "ts": row.get("timestamp")}
                    texts_since_tool.append(entry)
                    last_text = entry
        elif kind == "attachment" and not row.get("isSidechain"):
            # A message the user typed while a turn was running. Claude Code hands it
            # to the model mid-turn and records it as a queued command, not a user row.
            queued = row.get("attachment") or {}
            origin = queued.get("origin") or {}
            text = queued.get("prompt")
            if queued.get("type") != "queued_command" or origin.get("kind") != "human":
                continue
            if queued.get("isMeta") or not isinstance(text, str) or not text.strip():
                continue
            if text.lstrip().startswith(NON_PROMPT_PREFIXES):
                continue
            # The turn carries on, so the earlier prompt gets no response of its own:
            # the turn's final response is logged once, under its last prompt.
            current = {
                "prompt": text.strip("\n"),
                "prompt_ts": queued.get("timestamp") or row.get("timestamp"),
                "model": last_model,
            }
            exchanges.append(current)
            texts_since_tool = []
            last_text = None
        elif kind == "user" and not row.get("isSidechain"):
            content = (row.get("message") or {}).get("content")
            if content is None:
                continue
            text = user_text(content)
            if text is None:
                result = row.get("toolUseResult")
                if isinstance(result, dict) and result.get("answers") and current is not None:
                    current["ask_ts"] = row.get("timestamp")
                    close(render_questions(result.get("questions")))
                    current = {
                        "prompt": render_answers(result),
                        "prompt_ts": row.get("timestamp"),
                        "model": last_model,
                    }
                    exchanges.append(current)
                    last_text = None
                texts_since_tool = []
                continue
            if not is_human_prompt(row, text):
                continue
            close()
            current = {"prompt": text.strip("\n"), "prompt_ts": row.get("timestamp"), "model": last_model}
            exchanges.append(current)
            texts_since_tool = []
            last_text = None
    close()
    return exchanges


def squash(text):
    text = re.sub(r"</?pasted_content[^>]*>", "", text or "")
    return re.sub(r"\s+", " ", text).strip()


def git_author(project_dir):
    try:
        url = subprocess.run(
            ["git", "-C", project_dir, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        match = re.search(r"github\.com[:/]([^/]+)/", url)
        if match:
            return match.group(1)
        name = subprocess.run(
            ["git", "-C", project_dir, "config", "user.name"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        return name or "unknown"
    except Exception:
        return "unknown"


def render(session_id, project, author, exchanges):
    short = session_id[:8]
    first = exchanges[0]["prompt_ts"]
    last = exchanges[-1]["prompt_ts"]
    models = []
    for ex in exchanges:
        if ex.get("model") and ex["model"] not in models:
            models.append(ex["model"])
    out = [
        "---",
        "session_id: " + session_id,
        "date: " + first[:10],
        "author: " + author,
        "model: " + (", ".join(models) or "unknown"),
        "tool: " + TOOL,
        "project: " + project,
        "total_exchanges: " + str(len(exchanges)),
        "first_prompt_time: " + first,
        "last_prompt_time: " + last,
        "---",
        "",
        "# Session Log - " + first[:10],
        "",
        "Session: `%s` | Project: `%s` | Author: `%s`" % (short, project, author),
        "",
        "---",
        "",
    ]
    for num, ex in enumerate(exchanges, 1):
        model = ex.get("model") or "unknown"
        out += [
            "[LOG_ENTRY type=PROMPT num=%d session=%s]" % (num, short),
            "timestamp: " + ex["prompt_ts"],
            "model: " + model,
            "",
            ex["prompt"],
            "",
            "",
        ]
        if ex.get("response"):
            out += [
                "[LOG_ENTRY type=RESPONSE num=%d session=%s]" % (num, short),
                "timestamp: " + (ex.get("response_ts") or ex["prompt_ts"]),
                "model: " + model,
                "",
                ex["response"],
                "",
                "",
            ]
    return "\n".join(out).rstrip("\n") + "\n"


def main():
    hook = json.load(sys.stdin)
    event = hook.get("hook_event_name", "")
    session_id = hook.get("session_id") or "unknown-session"
    transcript = hook.get("transcript_path") or ""
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or hook.get("cwd") or os.getcwd()
    project = os.path.basename(os.path.normpath(project_dir))

    exchanges = []
    # At Stop the last assistant message can still be on its way to disk; wait briefly for it.
    for attempt in range(6):
        rows = read_transcript(transcript) if transcript and os.path.exists(transcript) else []
        exchanges = build_exchanges(rows)
        if event != "Stop" or (exchanges and exchanges[-1].get("response")):
            break
        time.sleep(0.4)

    if event == "UserPromptSubmit":
        prompt = hook.get("prompt") or ""
        seen = squash(exchanges[-1]["prompt"]) if exchanges else ""
        fresh = squash(prompt)
        already = bool(seen) and not exchanges[-1].get("response") and (fresh in seen or seen in fresh)
        # Sub-agent reports and task notifications also arrive through this event. They are not prompts.
        from_user = not prompt.lstrip().startswith(NON_PROMPT_PREFIXES)
        if fresh and from_user and not already:
            exchanges.append({
                "prompt": prompt.strip("\n"),
                "prompt_ts": now_utc(),
                "model": exchanges[-1].get("model") if exchanges else None,
            })
    elif event == "Stop":
        final = (hook.get("last_assistant_message") or "").strip()
        if final and exchanges and not exchanges[-1].get("response"):
            exchanges[-1]["response"] = final
            exchanges[-1]["response_ts"] = now_utc()

    if not exchanges:
        return

    log_dir = os.path.join(project_dir, LOG_DIR_NAME)
    os.makedirs(log_dir, exist_ok=True)
    existing = glob.glob(os.path.join(log_dir, "*_%s.md" % session_id))
    if existing:
        path = existing[0]
        with open(path, encoding="utf-8") as f:
            old_entries = f.read().count("\n[LOG_ENTRY ")
    else:
        stamp = exchanges[0]["prompt_ts"][:19].replace("T", "_").replace(":", "-")
        path = os.path.join(log_dir, "%s_%s.md" % (stamp, session_id))
        old_entries = 0

    text = render(session_id, project, git_author(project_dir), exchanges)
    # Never let a short or unreadable transcript erase entries that were already logged.
    if text.count("\n[LOG_ENTRY ") < old_entries:
        sys.stderr.write("agent-capture: transcript has fewer entries than %s; left it untouched\n" % path)
        sys.exit(1)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # exit 1 shows the error to the user without blocking the turn
        sys.stderr.write("agent-capture failed: %r\n" % (exc,))
        sys.exit(1)
