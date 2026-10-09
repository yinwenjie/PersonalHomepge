// The fixed targets of the egress probe. scripts/rss-egress-probe.mjs imports this file too, to
// check that a report covers exactly these targets.

export interface Target {
  name: string;
  url: string;
  /** true for the public control, which must answer; every other target must not. */
  control?: boolean;
  /** true when failing to resolve the name already means it cannot be reached. */
  unresolvableIsBlocked?: boolean;
}

const BLOCKED_TARGETS: Target[] = [
  { name: "cloud metadata IPv4", url: "http://169.254.169.254/latest/meta-data/" },
  { name: "cloud metadata IPv6", url: "http://[fd00:ec2::254]/latest/meta-data/" },
  {
    name: "metadata hostname",
    url: "http://metadata.google.internal/",
    unresolvableIsBlocked: true,
  },
  { name: "public name resolving to metadata", url: "http://169.254.169.254.nip.io/" },
  { name: "public name resolving to private", url: "http://10.0.0.1.nip.io/" },
  { name: "private 10/8", url: "http://10.0.0.1/" },
  { name: "private 172.16/12", url: "http://172.16.0.1/" },
  { name: "private 192.168/16", url: "http://192.168.0.1/" },
  { name: "loopback IPv4", url: "http://127.0.0.1/" },
  { name: "loopback IPv6", url: "http://[::1]/" },
];

// rss-proxy fetches both schemes, so every blocked target is tried on port 80 and port 443.
export const TARGETS: Target[] = [
  { name: "public control", url: "https://example.com/", control: true },
  ...BLOCKED_TARGETS.flatMap((target) => [
    target,
    { ...target, name: `${target.name} (HTTPS)`, url: target.url.replace(/^http:/, "https:") },
  ]),
];
