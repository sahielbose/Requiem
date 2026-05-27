import { Octokit } from "@octokit/rest";
import { randomUUID } from "node:crypto";
import type { BashScript } from "../types";

const MAX_SCRIPTS = 50;
const MAX_SHEBANG_PROBES = 20;
const SHEBANG_RE = /^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:bash|sh|zsh|ksh)\b/;
const SCRIPT_PATHS_RE =
  /(^|\/)(scripts?|bin|runbooks?|cron|ci|ops|hooks?|tools?|deploy)\//i;

function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function blobToText(content: string, encoding: string): string | null {
  if (encoding === "base64") {
    return Buffer.from(content, "base64").toString("utf8");
  }
  if (encoding === "utf-8" || encoding === "utf8") {
    return content;
  }
  return null;
}

async function fetchBlob(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<string | null> {
  try {
    const res = await octokit.git.getBlob({ owner, repo, file_sha: sha });
    return blobToText(res.data.content, res.data.encoding);
  } catch (err) {
    console.warn(
      "[scanner] blob fetch failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

function toBashScript(
  repoUrl: string,
  path: string,
  content: string
): BashScript {
  const filename = path.split("/").pop() || path;
  return {
    id: randomUUID(),
    repoUrl,
    path,
    filename,
    content,
    createdAt: new Date().toISOString(),
  };
}

export async function scanRepoForScripts(
  repoUrl: string
): Promise<BashScript[]> {
  try {
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) {
      console.warn(`[scanner] could not parse repo url: ${repoUrl}`);
      return [];
    }
    const { owner, repo } = parsed;

    const auth = process.env.GITHUB_TOKEN || undefined;
    const octokit = new Octokit({ auth });

    const repoInfo = await octokit.repos.get({ owner, repo });
    const branch = repoInfo.data.default_branch;

    const branchRef = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const commitSha = branchRef.data.object.sha;
    const commit = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: commitSha,
    });
    const treeSha = commit.data.tree.sha;

    const tree = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: "true",
    });
    if (tree.data.truncated) {
      console.warn(`[scanner] tree truncated for ${owner}/${repo}`);
    }

    const blobs = tree.data.tree.filter(
      (n): n is typeof n & { path: string; sha: string } =>
        n.type === "blob" && typeof n.path === "string" && typeof n.sha === "string"
    );

    const shFiles: typeof blobs = [];
    const shebangCandidates: typeof blobs = [];
    for (const b of blobs) {
      if (/\.sh$/i.test(b.path)) {
        shFiles.push(b);
      } else if (!/\.[a-z0-9]+$/i.test(b.path) && SCRIPT_PATHS_RE.test(b.path)) {
        shebangCandidates.push(b);
      }
    }

    const results: BashScript[] = [];

    for (const b of shFiles) {
      if (results.length >= MAX_SCRIPTS) break;
      const content = await fetchBlob(octokit, owner, repo, b.sha);
      if (content === null) continue;
      results.push(toBashScript(repoUrl, b.path, content));
    }

    let probes = 0;
    for (const b of shebangCandidates) {
      if (results.length >= MAX_SCRIPTS) break;
      if (probes >= MAX_SHEBANG_PROBES) break;
      probes++;
      const content = await fetchBlob(octokit, owner, repo, b.sha);
      if (content === null) continue;
      if (SHEBANG_RE.test(content)) {
        results.push(toBashScript(repoUrl, b.path, content));
      }
    }

    console.log(
      `[scanner] ${owner}/${repo}: ${results.length} script(s) found (${shFiles.length} .sh + ${probes} probes)`
    );
    return results;
  } catch (err) {
    console.error(
      "[scanner] failed:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
