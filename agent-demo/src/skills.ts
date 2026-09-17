import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * A tiny, dependency-free reader for the Agent Skills format
 * (https://agentskills.io/specification) this repo's `./agent-skills`
 * package follows. It intentionally mimics how a real skills-compatible
 * runtime (Claude, Hermes Agent, OpenClaw) is specified to load a skill:
 * only `name` + `description` at startup, the full `SKILL.md` body once a
 * task matches, and `references/*` files only on demand. No YAML library —
 * `SKILL.md`'s frontmatter only ever needs a handful of shapes (scalars,
 * a folded `>` block, one level of nesting for `metadata:`).
 */

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
}

export interface SkillSummary {
  dir: string;
  frontmatter: SkillFrontmatter;
}

const FRONTMATTER_DELIM = /^---\s*$/;

/** Splits a SKILL.md file into its YAML frontmatter block and the instructional body below it. */
function splitFrontmatter(content: string): { frontmatterText: string; body: string } {
  const lines = content.split("\n");
  if (!FRONTMATTER_DELIM.test(lines[0] ?? "")) {
    throw new Error("SKILL.md must start with a YAML frontmatter block delimited by ---");
  }
  const endIndex = lines.slice(1).findIndex((l) => FRONTMATTER_DELIM.test(l));
  if (endIndex === -1) throw new Error("SKILL.md frontmatter is missing its closing ---");
  const frontmatterText = lines.slice(1, endIndex + 1).join("\n");
  const body = lines
    .slice(endIndex + 2)
    .join("\n")
    .replace(/^\n+/, "");
  return { frontmatterText, body };
}

function indentOf(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1]!.length : 0;
}

/** Parses just enough YAML to read this repo's SKILL.md frontmatter shape — not a general-purpose parser. */
function parseFrontmatter(text: string): SkillFrontmatter {
  const lines = text.split("\n");
  const result: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const topMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!topMatch) {
      i++;
      continue;
    }
    const [, key, rest] = topMatch;
    if (rest === ">" || rest === "|") {
      // Folded (>) or literal (|) block scalar: consume subsequent more-indented lines.
      const collected: string[] = [];
      i++;
      while (i < lines.length && (lines[i]!.trim() === "" || indentOf(lines[i]!) > 0)) {
        collected.push(lines[i]!.trim());
        i++;
      }
      result[key!] = rest === ">" ? collected.filter(Boolean).join(" ") : collected.join("\n");
    } else if (rest === "") {
      // Nested mapping (used here only for `metadata:`).
      const nested: Record<string, string> = {};
      i++;
      while (i < lines.length && lines[i]!.trim() !== "" && indentOf(lines[i]!) > 0) {
        const nestedMatch = lines[i]!.trim().match(/^([A-Za-z0-9_-]+):\s*"?([^"]*)"?$/);
        if (nestedMatch) nested[nestedMatch[1]!] = nestedMatch[2]!;
        i++;
      }
      result[key!] = nested;
    } else {
      result[key!] = rest!.trim();
      i++;
    }
  }

  if (!result.name || !result.description) {
    throw new Error("SKILL.md frontmatter must declare both name and description");
  }
  return result as unknown as SkillFrontmatter;
}

/** Step 1 of progressive disclosure: read only name+description, as a real runtime would at startup. */
export function loadSkillSummary(skillDir: string): SkillSummary {
  const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const { frontmatterText } = splitFrontmatter(content);
  return { dir: skillDir, frontmatter: parseFrontmatter(frontmatterText) };
}

/** Step 2: read the full instructional body — done once a task (webhook or natural-language ask) matches. */
export function loadSkillBody(skillDir: string): string {
  const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  return splitFrontmatter(content).body;
}

/** Step 3: list `references/*` (+ the bundled CLI's own README) without reading their contents yet. */
export function listSkillReferences(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(full);
      } else if (entry.endsWith(".md") && entry !== "SKILL.md") {
        out.push(relative(skillDir, full));
      }
    }
  };
  walk(join(skillDir, "references"));
  const cliReadme = join(skillDir, "scripts", "cli", "README.md");
  try {
    statSync(cliReadme);
    out.push(relative(skillDir, cliReadme));
  } catch {
    // optional
  }
  return out.sort();
}

/** Step 3b: read one reference file on demand — path-traversal-guarded to stay inside the skill dir. */
export function readSkillReference(skillDir: string, relativePath: string): string {
  const target = resolve(skillDir, relativePath);
  if (!target.startsWith(resolve(skillDir) + "/")) {
    throw new Error(`Refusing to read outside the skill directory: ${relativePath}`);
  }
  return readFileSync(target, "utf8");
}
