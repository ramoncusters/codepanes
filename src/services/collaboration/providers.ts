import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CollaborationPage,
  CollaborationProvider,
  CollaborationProviderCapabilities,
  CollaborationQuery,
  Issue,
  IssueDetails,
  Pipeline,
  PipelineDetails,
  PullRequest,
  PullRequestDetails,
  PullRequestDiff,
} from "./types.js";
import { parseUnifiedDiff } from "./diff.js";

const execFileAsync = promisify(execFile);

const unsupported = (operation: string): Promise<never> =>
  Promise.reject(new Error(`${operation} is not implemented for this provider yet`));

async function runJsonCommand<T>(command: string, args: string[]): Promise<T> {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

async function runTextCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

abstract class CliProvider implements CollaborationProvider {
  abstract readonly id: "github" | "azure";
  abstract readonly capabilities: CollaborationProviderCapabilities;

  abstract listPullRequests(query: CollaborationQuery): Promise<CollaborationPage<PullRequest>>;
  abstract getPullRequest(id: string): Promise<PullRequestDetails>;

  abstract getPullRequestDiff(id: string): Promise<PullRequestDiff>;

  listPipelines(_query: CollaborationQuery): Promise<CollaborationPage<Pipeline>> {
    return unsupported("Pipeline listing");
  }

  getPipeline(_id: string): Promise<PipelineDetails> {
    return unsupported("Pipeline details");
  }

  getPipelineLog(_jobId: string): Promise<string> {
    return unsupported("Pipeline logs");
  }

  listIssues(_query: CollaborationQuery): Promise<CollaborationPage<Issue>> {
    return unsupported("Issue listing");
  }

  getIssue(_id: string): Promise<IssueDetails> {
    return unsupported("Issue details");
  }
}

type GitHubPullRequest = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged_at: string | null;
  draft: boolean;
  user: { login: string };
  head: { ref: string };
  base: { ref: string };
  updated_at: string;
  html_url: string;
  created_at: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
};

export class GitHubProvider extends CliProvider {
  readonly id = "github" as const;
  readonly capabilities: CollaborationProviderCapabilities = {
    pullRequests: true,
    pullRequestDiffs: false,
    pullRequestComments: false,
    pipelines: false,
    pipelineLogs: false,
    pipelineControls: false,
    issues: false,
    issueMutations: false,
  };

  constructor(
    private readonly owner: string,
    private readonly repository: string,
  ) {
    super();
  }

  async listPullRequests(query: CollaborationQuery): Promise<CollaborationPage<PullRequest>> {
    const page = Math.max(1, Number(query.cursor ?? "1") || 1);
    const params = new URLSearchParams({ state: "all", per_page: "30", page: String(page) });
    const items = await runJsonCommand<GitHubPullRequest[]>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls?${params}`,
    ]);
    return {
      items: items.map((pullRequest) => this.mapPullRequest(pullRequest)),
      hasNextPage: items.length === 30,
      nextCursor: String(page + 1),
    };
  }

  async getPullRequest(id: string): Promise<PullRequestDetails> {
    const pullRequest = await runJsonCommand<GitHubPullRequest>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls/${id}`,
    ]);
    const mapped = this.mapPullRequest(pullRequest);
    return {
      ...mapped,
      createdAt: pullRequest.created_at,
      additions: pullRequest.additions ?? 0,
      deletions: pullRequest.deletions ?? 0,
      changedFiles: pullRequest.changed_files ?? 0,
      capabilities: {
        canComment: false,
        canChangeCommentStatus: false,
        canMerge: false,
        canAbandon: false,
      },
    };
  }

  async getPullRequestDiff(id: string): Promise<PullRequestDiff> {
    const rawDiff = await runTextCommand("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls/${id}`,
      "--header",
      "Accept: application/vnd.github.v3.diff",
    ]);
    return parseUnifiedDiff(rawDiff);
  }

  private mapPullRequest(pullRequest: GitHubPullRequest): PullRequest {
    return {
      id: String(pullRequest.number),
      number: pullRequest.number,
      title: pullRequest.title,
      description: pullRequest.body ?? undefined,
      status: pullRequest.merged_at ? "merged" : pullRequest.draft ? "draft" : pullRequest.state,
      author: pullRequest.user.login,
      sourceBranch: pullRequest.head.ref,
      targetBranch: pullRequest.base.ref,
      updatedAt: pullRequest.updated_at,
      url: pullRequest.html_url,
    };
  }
}

type AzurePullRequest = {
  pullRequestId: number;
  title: string;
  description: string;
  status: "active" | "completed" | "abandoned";
  createdBy: { displayName: string };
  sourceRefName: string;
  targetRefName: string;
  creationDate: string;
  closedDate?: string;
  url: string;
};

export class AzureProvider extends CliProvider {
  readonly id = "azure" as const;
  readonly capabilities: CollaborationProviderCapabilities = {
    pullRequests: true,
    pullRequestDiffs: false,
    pullRequestComments: false,
    pipelines: false,
    pipelineLogs: false,
    pipelineControls: false,
    issues: false,
    issueMutations: false,
  };

  constructor(
    private readonly organization: string,
    private readonly project: string,
    private readonly repository: string,
  ) {
    super();
  }

  async listPullRequests(query: CollaborationQuery): Promise<CollaborationPage<PullRequest>> {
    const page = Math.max(1, Number(query.cursor ?? "1") || 1);
    const items = await runJsonCommand<AzurePullRequest[]>("az", [
      "repos",
      "pr",
      "list",
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--repository",
      this.repository,
      "--status",
      "all",
      "--top",
      "30",
      "--skip",
      String((page - 1) * 30),
      "--output",
      "json",
    ]);
    return {
      items: items.map((pullRequest) => this.mapPullRequest(pullRequest)),
      hasNextPage: items.length === 30,
      nextCursor: String(page + 1),
    };
  }

  async getPullRequest(id: string): Promise<PullRequestDetails> {
    const pullRequest = await runJsonCommand<AzurePullRequest>("az", [
      "repos",
      "pr",
      "show",
      "--id",
      id,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--repository",
      this.repository,
      "--output",
      "json",
    ]);
    const mapped = this.mapPullRequest(pullRequest);
    return {
      ...mapped,
      createdAt: pullRequest.creationDate,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      capabilities: {
        canComment: false,
        canChangeCommentStatus: false,
        canMerge: false,
        canAbandon: false,
      },
    };
  }

  async getPullRequestDiff(id: string): Promise<PullRequestDiff> {
    const rawDiff = await runTextCommand("az", [
      "repos",
      "pr",
      "diff",
      "--id",
      id,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--repository",
      this.repository,
    ]);
    return parseUnifiedDiff(rawDiff);
  }

  private mapPullRequest(pullRequest: AzurePullRequest): PullRequest {
    const status = pullRequest.status === "active"
      ? "open"
      : pullRequest.status === "completed"
        ? "merged"
        : "closed";
    return {
      id: String(pullRequest.pullRequestId),
      number: pullRequest.pullRequestId,
      title: pullRequest.title,
      description: pullRequest.description || undefined,
      status,
      author: pullRequest.createdBy.displayName,
      sourceBranch: pullRequest.sourceRefName.replace(/^refs\/heads\//, ""),
      targetBranch: pullRequest.targetRefName.replace(/^refs\/heads\//, ""),
      updatedAt: pullRequest.closedDate ?? pullRequest.creationDate,
      url: pullRequest.url,
    };
  }
}
