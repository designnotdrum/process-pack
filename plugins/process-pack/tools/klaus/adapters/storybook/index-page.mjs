/**
 * The version index: one static page that links every release's Storybook, and
 * `versions.json` with the same list for tools. It is regenerated on every run
 * from the release deployments that Vercel lists, then deployed as the
 * project's production deployment.
 */
import { aliasFor } from "./vercel.mjs";

/** One entry per release. If a release was deployed more than once, the newest wins. Newest release first. */
export function latestPerRelease(entries) {
  const newest = new Map();
  for (const entry of entries) {
    const kept = newest.get(entry.release);
    if (!kept || entry.createdAt > kept.createdAt) newest.set(entry.release, entry);
  }
  return [...newest.values()].sort((a, b) => b.createdAt - a.createdAt || (a.release < b.release ? -1 : 1));
}

const escapeHtml = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dateOf = (createdAt) => new Date(createdAt).toISOString().slice(0, 10);

/**
 * @param {object} args
 * @param {string} args.project
 * @param {Array<{ release: string, alias: string | null, commit: string | null, createdAt: number }>} args.releases
 *   Already reduced to one entry per release, newest first.
 * @returns {{ "index.html": string, "versions.json": string }}
 */
export function renderIndex({ project, releases }) {
  const rows = releases.map((entry) => ({
    release: entry.release,
    url: `https://${entry.alias ?? aliasFor(project, entry.release)}/`,
    commit: entry.commit,
    createdAt: new Date(entry.createdAt).toISOString(),
  }));

  const body =
    rows.length === 0
      ? "<p>No releases yet.</p>"
      : `<p>Latest: <a href="${escapeHtml(rows[0].url)}">${escapeHtml(rows[0].release)}</a></p>
<table>
<thead><tr><th scope="col">Release</th><th scope="col">Commit</th><th scope="col">Deployed</th></tr></thead>
<tbody>
${rows
  .map(
    (row) =>
      `<tr><td><a href="${escapeHtml(row.url)}">${escapeHtml(row.release)}</a></td><td>${row.commit ? `<code>${escapeHtml(row.commit.slice(0, 7))}</code>` : ""}</td><td>${row.createdAt.slice(0, 10)}</td></tr>`,
  )
  .join("\n")}
</tbody>
</table>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(project)} Storybook releases</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.4rem 0.75rem 0.4rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
</style>
</head>
<body>
<h1>${escapeHtml(project)} Storybook releases</h1>
${body}
</body>
</html>
`;

  const versions = { schemaVersion: 1, project, releases: rows.map(({ release, url, commit, createdAt }) => ({ release, url, commit, createdAt })) };
  return { "index.html": html, "versions.json": `${JSON.stringify(versions, null, 2)}\n` };
}
