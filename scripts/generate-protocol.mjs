// Generates TypeScript and Python protocol modules from packages/shared/protocol.json.
// Usage: node scripts/generate-protocol.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const protocol = JSON.parse(
  readFileSync(join(root, "packages", "shared", "protocol.json"), "utf8"),
);

const header = "// GENERATED FILE — do not edit. Source: packages/shared/protocol.json (npm run protocol:generate)";

const ts = `${header}
export const PROTOCOL = ${JSON.stringify(protocol, null, 2)} as const;

export type RunStatus = (typeof PROTOCOL.run_statuses)[number];
export type Stage = (typeof PROTOCOL.stages)[number];
export type StageStatus = (typeof PROTOCOL.stage_statuses)[number];
export type EventSeverity = (typeof PROTOCOL.event_severities)[number];
export type EventType = (typeof PROTOCOL.event_types)[number];
export type ArtifactType = (typeof PROTOCOL.artifact_types)[number];
export type ApprovalKind = (typeof PROTOCOL.approval_kinds)[number];
export type FailureDecision = (typeof PROTOCOL.failure_decisions)[number];
export type InstantlyUploadStatus = (typeof PROTOCOL.instantly_upload_statuses)[number];
export type CredentialStatus = (typeof PROTOCOL.credential_statuses)[number];
`;

const py = `# GENERATED FILE — do not edit. Source: packages/shared/protocol.json (npm run protocol:generate)
import json

PROTOCOL = json.loads(r"""${JSON.stringify(protocol, null, 2)}""")

PROTOCOL_VERSION = PROTOCOL["protocol_version"]
RUN_STATUSES = PROTOCOL["run_statuses"]
TERMINAL_STATUSES = PROTOCOL["terminal_statuses"]
STAGES = PROTOCOL["stages"]
STAGE_STATUSES = PROTOCOL["stage_statuses"]
EVENT_SEVERITIES = PROTOCOL["event_severities"]
EVENT_TYPES = PROTOCOL["event_types"]
ARTIFACT_TYPES = PROTOCOL["artifact_types"]
ARTIFACT_STAGE_MAP = PROTOCOL["artifact_stage_map"]
APPROVAL_KINDS = PROTOCOL["approval_kinds"]
FAILURE_DECISIONS = PROTOCOL["failure_decisions"]
INSTANTLY_UPLOAD_STATUSES = PROTOCOL["instantly_upload_statuses"]
RETRY_POLICY = PROTOCOL["retry_policy"]
LIMITS = PROTOCOL["limits"]
CREDENTIAL_KEYS = PROTOCOL["credential_keys"]
CREDENTIAL_STATUSES = PROTOCOL["credential_statuses"]
`;

const targets = [
  [join(root, "packages", "shared", "src", "protocol.ts"), ts],
  [join(root, "runner", "aureli_runner", "protocol.py"), py],
];

const check = process.argv.includes("--check");
let drift = false;
for (const [path, content] of targets) {
  if (check) {
    let existing = "";
    try {
      existing = readFileSync(path, "utf8");
    } catch {
      /* missing counts as drift */
    }
    if (existing !== content) {
      console.error(`DRIFT: ${path} is out of date with protocol.json`);
      drift = true;
    }
  } else {
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
}
if (check && drift) process.exit(1);
if (check) console.log("protocol generated files are in sync");
