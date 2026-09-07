import type { CollaborationProviderId } from "./types.js";

export function detectCollaborationProvider(remoteUrl: string): CollaborationProviderId | undefined {
  const normalizedUrl = remoteUrl.trim().toLowerCase();
  if (normalizedUrl.includes("github.com")) return "github";
  if (normalizedUrl.includes("dev.azure.com") || normalizedUrl.includes("visualstudio.com")) {
    return "azure";
  }
  return undefined;
}
