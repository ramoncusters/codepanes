import { detectCollaborationProvider } from "./providerDetection.js";
import { AzureProvider, GitHubProvider } from "./providers.js";
import type { CollaborationProvider } from "./types.js";

function parseGitHubRemote(remoteUrl: string): { owner: string; repository: string } | undefined {
  const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  return match ? { owner: match[1], repository: match[2] } : undefined;
}

function parseAzureRemote(remoteUrl: string): {
  organization: string;
  project: string;
  repository: string;
} | undefined {
  const match = remoteUrl.match(/(?:dev\.azure\.com\/([^/]+)\/([^/]+)|([^/.]+)\.visualstudio\.com\/([^/]+))\/_git\/([^/]+?)(?:\.git)?$/i);
  if (!match) return undefined;
  return {
    organization: match[1] ?? match[3],
    project: match[2] ?? match[4],
    repository: match[5],
  };
}

export function createCollaborationProvider(remoteUrl: string): CollaborationProvider | undefined {
  const provider = detectCollaborationProvider(remoteUrl);
  if (provider === "github") {
    const repository = parseGitHubRemote(remoteUrl);
    return repository ? new GitHubProvider(repository.owner, repository.repository) : undefined;
  }
  if (provider === "azure") {
    const repository = parseAzureRemote(remoteUrl);
    return repository
      ? new AzureProvider(repository.organization, repository.project, repository.repository)
      : undefined;
  }
  return undefined;
}
