// One long-running follow-to-DM process per workspace.
// node workers/roleflow-dm/run.mjs <workspace-id>
// The Instagram password is not an argument and is not written anywhere.
// Sessions live in ROLEFLOW_DM_SESSION_DIR/<workspace-id>.bin and .key.

const workspaceId = process.argv[2] || process.env.ROLEFLOW_DM_WORKSPACE || "";

if (!workspaceId) {
  console.log(JSON.stringify({ ok: false, reason: "missing_workspace" }));
  process.exit(0);
}

const { runLoop } = await import("./loop.mjs");
const code = await runLoop({ workspaceId, env: process.env });
process.exit(code);
