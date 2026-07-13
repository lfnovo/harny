export function parseTrustedGitHubRemote(url: string): string {
  const https = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i);
  const ssh = url.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/i);
  const match = https ?? ssh; if (!match) throw new Error(`origin is not a trusted GitHub remote: ${url}`); return `${match[1]}/${match[2]}`;
}
