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
  PullRequestComment,
  PullRequestCommentInput,
  PullRequestCommentSide,
  PullRequestCommentStatus,
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
  abstract listPullRequestComments(id: string): Promise<CollaborationPage<PullRequestComment>>;
  abstract createPullRequestComment(
    id: string,
    comment: PullRequestCommentInput,
  ): Promise<PullRequestComment>;
  abstract updatePullRequestCommentStatus(
    pullRequestId: string,
    commentId: string,
    status: PullRequestCommentStatus,
  ): Promise<PullRequestComment>;
  abstract mergePullRequest(id: string): Promise<PullRequestDetails>;
  abstract completePullRequest(id: string): Promise<PullRequestDetails>;
  abstract abandonPullRequest(id: string): Promise<PullRequestDetails>;

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
  head: { ref: string; sha: string };
  base: { ref: string };
  updated_at: string;
  html_url: string;
  created_at: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
};

type GitHubReviewComment = {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
  path?: string;
  line?: number | null;
  side?: "LEFT" | "RIGHT";
  html_url?: string;
};

export class GitHubProvider extends CliProvider {
  readonly id = "github" as const;
  readonly capabilities: CollaborationProviderCapabilities = {
    pullRequests: true,
    pullRequestDiffs: true,
    pullRequestComments: true,
    pullRequestCommentStatus: false,
    pullRequestActions: true,
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
        canComment: true,
        canChangeCommentStatus: false,
        canMerge: true,
        canComplete: false,
        canAbandon: true,
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

  async listPullRequestComments(id: string): Promise<CollaborationPage<PullRequestComment>> {
    const pages = await runJsonCommand<GitHubReviewComment[][]>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls/${id}/comments`,
      "--paginate",
      "--slurp",
    ]);
    const comments = pages.flat();
    return {
      items: comments.map((comment) => this.mapComment(comment)),
      hasNextPage: false,
    };
  }

  async createPullRequestComment(
    id: string,
    comment: PullRequestCommentInput,
  ): Promise<PullRequestComment> {
    const pullRequest = await runJsonCommand<GitHubPullRequest>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls/${id}`,
    ]);
    const args = [
      "api",
      `repos/${this.owner}/${this.repository}/pulls/${id}/comments`,
      "--method",
      "POST",
      "--field",
      `body=${comment.body}`,
      "--field",
      `commit_id=${pullRequest.head.sha}`,
      "--field",
      `path=${comment.filePath}`,
    ];
    if (comment.line === undefined) {
      args.push("--field", "subject_type=file");
    } else {
      args.push(
        "--field",
        `line=${comment.line}`,
        "--field",
        `side=${comment.side === "left" ? "LEFT" : "RIGHT"}`,
      );
    }
    const created = await runJsonCommand<GitHubReviewComment>("gh", args);
    return this.mapComment(created);
  }

  updatePullRequestCommentStatus(
    _pullRequestId: string,
    _commentId: string,
    _status: PullRequestCommentStatus,
  ): Promise<PullRequestComment> {
    return unsupported("Changing GitHub comment status");
  }

  async mergePullRequest(id: string): Promise<PullRequestDetails> {
    const result = await runJsonCommand<{ merged: boolean; message?: string }>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls/${id}/merge`,
      "--method",
      "PUT",
      "--field",
      "merge_method=merge",
    ]);
    if (!result.merged) {
      throw new Error(result.message ?? "GitHub did not merge the pull request");
    }
    return this.getPullRequest(id);
  }

  completePullRequest(id: string): Promise<PullRequestDetails> {
    return this.mergePullRequest(id);
  }

  async abandonPullRequest(id: string): Promise<PullRequestDetails> {
    await runJsonCommand<GitHubPullRequest>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls/${id}`,
      "--method",
      "PATCH",
      "--field",
      "state=closed",
    ]);
    return this.getPullRequest(id);
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

  private mapComment(comment: GitHubReviewComment): PullRequestComment {
    return {
      id: String(comment.id),
      kind: comment.line === undefined ? "file" : "line",
      body: comment.body,
      author: comment.user.login,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      status: "active",
      filePath: comment.path,
      line: comment.line ?? undefined,
      side: comment.side?.toLowerCase() as PullRequestCommentSide | undefined,
      url: comment.html_url,
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

type AzureThreadComment = {
  id: number;
  content: string;
  author?: { displayName?: string };
  publishedDate?: string;
  lastUpdatedDate?: string;
};

type AzurePullRequestThread = {
  id: number;
  status?: string;
  comments?: AzureThreadComment[];
  threadContext?: {
    filePath?: string;
    rightFileStart?: { line?: number };
    leftFileStart?: { line?: number };
  };
  url?: string;
};

export class AzureProvider extends CliProvider {
  readonly id = "azure" as const;
  readonly capabilities: CollaborationProviderCapabilities = {
    pullRequests: true,
    pullRequestDiffs: true,
    pullRequestComments: true,
    pullRequestCommentStatus: true,
    pullRequestActions: true,
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
        canComment: true,
        canChangeCommentStatus: true,
        canMerge: false,
        canComplete: true,
        canAbandon: true,
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

  async listPullRequestComments(id: string): Promise<CollaborationPage<PullRequestComment>> {
    const threads = await runJsonCommand<AzurePullRequestThread[]>("az", [
      "repos",
      "pr",
      "thread",
      "list",
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
    return {
      items: threads.flatMap((thread) =>
        (thread.comments ?? []).map((comment) => this.mapComment(thread, comment))),
      hasNextPage: false,
    };
  }

  async createPullRequestComment(
    id: string,
    comment: PullRequestCommentInput,
  ): Promise<PullRequestComment> {
    const args = [
      "repos",
      "pr",
      "thread",
      "create",
      "--id",
      id,
      "--content",
      comment.body,
      "--file-path",
      comment.filePath,
    ];
    if (comment.line !== undefined) {
      args.push(
        "--line",
        String(comment.line),
        "--side",
        comment.side === "left" ? "Left" : "Right",
      );
    }
    args.push(
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--repository",
      this.repository,
      "--output",
      "json",
    );
    const thread = await runJsonCommand<AzurePullRequestThread>("az", args);
    const created = thread.comments?.at(-1);
    if (!created) {
      throw new Error("Azure DevOps did not return the created comment");
    }
    return this.mapComment(thread, created);
  }

  async updatePullRequestCommentStatus(
    _pullRequestId: string,
    commentId: string,
    status: PullRequestCommentStatus,
  ): Promise<PullRequestComment> {
    const thread = await runJsonCommand<AzurePullRequestThread>("az", [
      "repos",
      "pr",
      "thread",
      "update",
      "--id",
      commentId,
      "--status",
      status === "active" ? "active" : "fixed",
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--repository",
      this.repository,
      "--output",
      "json",
    ]);
    const updated = thread.comments?.at(-1);
    if (!updated) {
      throw new Error("Azure DevOps did not return the updated comment");
    }
    return this.mapComment(thread, updated);
  }

  completePullRequest(id: string): Promise<PullRequestDetails> {
    return this.updatePullRequestStatus(id, "completed");
  }

  mergePullRequest(id: string): Promise<PullRequestDetails> {
    return this.completePullRequest(id);
  }

  abandonPullRequest(id: string): Promise<PullRequestDetails> {
    return this.updatePullRequestStatus(id, "abandoned");
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

  private async updatePullRequestStatus(
    id: string,
    status: "completed" | "abandoned",
  ): Promise<PullRequestDetails> {
    await runJsonCommand<AzurePullRequest>("az", [
      "repos",
      "pr",
      "update",
      "--id",
      id,
      "--status",
      status,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--repository",
      this.repository,
      "--output",
      "json",
    ]);
    return this.getPullRequest(id);
  }

  private mapComment(
    thread: AzurePullRequestThread,
    comment: AzureThreadComment,
  ): PullRequestComment {
    const line = thread.threadContext?.rightFileStart?.line
      ?? thread.threadContext?.leftFileStart?.line;
    return {
      id: String(comment.id),
      kind: line === undefined ? "file" : "line",
      body: comment.content,
      author: comment.author?.displayName ?? "Unknown",
      createdAt: comment.publishedDate ?? "",
      updatedAt: comment.lastUpdatedDate,
      status: this.mapCommentStatus(thread.status),
      filePath: thread.threadContext?.filePath,
      line,
      side: line === undefined
        ? undefined
        : thread.threadContext?.rightFileStart?.line === undefined ? "left" : "right",
      url: thread.url,
      threadId: String(thread.id),
    };
  }

  private mapCommentStatus(status: string | undefined): PullRequestCommentStatus {
    if (!status) return "unknown";
    if (status.toLowerCase() === "active") return "active";
    if (status.toLowerCase() === "fixed") return "resolved";
    return "closed";
  }
}
