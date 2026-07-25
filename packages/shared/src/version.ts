import { PROTOCOL } from "./protocol";

/** Semver-lite comparison for protocol compatibility. */
function parse(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isProtocolCompatible(runnerProtocolVersion: string): boolean {
  const runner = parse(runnerProtocolVersion);
  const min = parse(PROTOCOL.min_compatible_protocol_version);
  const current = parse(PROTOCOL.protocol_version);
  if (!runner || !min || !current) return false;
  // Same major as current, and >= minimum compatible.
  if (runner[0] !== current[0]) return false;
  const [a, b, c] = runner;
  const [x, y, z] = min;
  if (a !== x) return a > x;
  if (b !== y) return b > y;
  return c >= z;
}

export function protocolWarning(runnerProtocolVersion: string): string | null {
  if (isProtocolCompatible(runnerProtocolVersion)) return null;
  return `Runner protocol ${runnerProtocolVersion || "(unknown)"} is incompatible with the web app (requires ${PROTOCOL.min_compatible_protocol_version} – ${PROTOCOL.protocol_version}). Update the runner: pip install -e ./runner`;
}
