import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CollaborationPage,
  CollaborationProvider,
  CollaborationProviderCapabilities,
  CollaborationQuery,
  Issue,
  IssueChild,
  IssueDetails,
  IssueIteration,
  IssueStatus,
  Pipeline,
  PipelineControlCapabilities,
  PipelineDetails,
  PipelineJob,
  PipelineStatus,
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

export type CollaborationErrorKind =
  | "authentication"
  | "permission"
  | "rate-limit"
  | "offline"
  | "network"
  | "command"
  | "unknown";

export class CollaborationError extends Error {
  readonly kind: CollaborationErrorKind;
  readonly providerCommand: string;
  readonly cause: unknown;

  constructor(kind: CollaborationErrorKind, providerCommand: string, message: string, cause?: unknown) {
    super(message);
    this.name = "CollaborationError";
    this.kind = kind;
    this.providerCommand = providerCommand;
    this.cause = cause;
  }
}

function commandErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
  return stderr ? `${error.message}: ${stderr}` : error.message;
}

function classifyCommandError(error: unknown): CollaborationErrorKind {
  const message = commandErrorDetail(error);
  if (/ENOENT|not found|is not recognized/i.test(message)) return "command";
  if (/authentication|unauthori[sz]ed|not logged in|login required|sign in|status code 401|\bHTTP 401\b|bad credentials|AADSTS|az login/i.test(message)) {
    return "authentication";
  }
  if (/forbidden|permission|access denied|requires? .*permission|not allowed|TF401027/i.test(message)) {
    return "permission";
  }
  if (/rate.?limit|too many requests|status code 429|\bHTTP 429\b|secondary rate limit/i.test(message)) {
    return "rate-limit";
  }
  if (/ENETUNREACH|ENETDOWN|ENONET|EHOSTUNREACH|offline|network is unreachable|no internet/i.test(message)) {
    return "offline";
  }
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network error|timed out|TLS|502|503|504/i.test(message)) {
    return "network";
  }
  return "unknown";
}

function isTransient(kind: CollaborationErrorKind): boolean {
  return kind === "offline" || kind === "network" || kind === "rate-limit";
}

function retryDelay(kind: CollaborationErrorKind, attempt: number): number {
  return kind === "rate-limit" ? 500 * attempt : 250 * attempt;
}

async function runProviderCommand<T>(
  command: string,
  args: string[],
  maxBuffer: number,
  parse: (stdout: string) => T,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      const { stdout } = await execFileAsync(command, args, { maxBuffer });
      return parse(stdout);
    } catch (error) {
      const kind = classifyCommandError(error);
      if (attempt < 1 && isTransient(kind)) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, retryDelay(kind, attempt)));
        continue;
      }
      const detail = commandErrorDetail(error);
      throw new CollaborationError(kind, command, `${command} request failed: ${detail}`, error);
    }
  }
}

async function runJsonCommand<T>(command: string, args: string[]): Promise<T> {
  return runProviderCommand(command, args, 10 * 1024 * 1024, (stdout) => JSON.parse(stdout) as T);
}

export function isAuthenticationError(error: unknown): boolean {
  if (error instanceof CollaborationError) return error.kind === "authentication";
  const message = error instanceof Error ? error.message : String(error);
  return /authentication|unauthori[sz]ed|not logged in|login required|sign in|status code 401|\bHTTP 401\b|bad credentials|AADSTS|az login/i.test(message);
}

export function getCollaborationErrorKind(error: unknown): CollaborationErrorKind {
  return error instanceof CollaborationError ? error.kind : classifyCommandError(error);
}

export function collaborationErrorMessage(error: unknown): string {
  const kind = getCollaborationErrorKind(error);
  switch (kind) {
    case "authentication":
      return "Authentication required. Sign in with the provider CLI and try again.";
    case "permission":
      return "The provider denied this operation. Check your account permissions and repository access.";
    case "rate-limit":
      return "The provider rate limit was reached. Wait a moment and try again.";
    case "offline":
      return "The provider is unavailable because this machine appears to be offline.";
    case "network":
      return "The provider could not be reached. Check your network connection and try again.";
    case "command":
      return "The provider CLI is unavailable. Install it and ensure it is on PATH.";
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

async function runTextCommand(command: string, args: string[]): Promise<string> {
  return runProviderCommand(command, args, 20 * 1024 * 1024, (stdout) => stdout);
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await runProviderCommand(command, args, 10 * 1024 * 1024, () => undefined);
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

  runPipeline(_id: string): Promise<void> {
    return unsupported("Running pipelines");
  }

  cancelPipeline(_id: string): Promise<void> {
    return unsupported("Canceling pipelines");
  }

  retryPipeline(_id: string): Promise<void> {
    return unsupported("Retrying pipelines");
  }

  approvePipeline(_id: string): Promise<void> {
    return unsupported("Approving pipelines");
  }

  resumePipeline(_id: string): Promise<void> {
    return unsupported("Resuming pipelines");
  }

  listIssues(_query: CollaborationQuery): Promise<CollaborationPage<Issue>> {
    return unsupported("Issue listing");
  }

  listIssueIterations(): Promise<CollaborationPage<IssueIteration>> {
    return unsupported("Issue iteration listing");
  }

  getIssue(_id: string): Promise<IssueDetails> {
    return unsupported("Issue details");
  }

  getIssueChildren(_id: string): Promise<IssueChild[]> {
    return unsupported("Issue child listing");
  }

  updateIssueStatus(_id: string, _status: IssueStatus): Promise<IssueDetails> {
    return unsupported("Changing issue status");
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
  repository?: { full_name?: string };
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

type GitHubWorkflowRun = {
  id: number;
  workflow_id?: number;
  name?: string;
  display_title?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string | null;
  head_sha?: string | null;
  run_started_at?: string | null;
  updated_at?: string;
  created_at?: string;
  html_url: string;
};

type GitHubWorkflowRunsResponse = {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
};

type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: { login: string };
  updated_at: string;
  created_at: string;
  html_url: string;
  labels?: Array<{ name: string }>;
  assignees?: Array<{ login: string }>;
  pull_request?: unknown;
};

type GitHubJob = {
  id: number;
  name: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
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
    pipelines: true,
    pipelineStages: false,
    pipelineJobs: true,
    pipelineLogs: true,
    pipelineControls: true,
    issues: true,
    issueMutations: true,
    issueIterations: false,
    issueChildren: false,
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
    if (query.branch) params.set("head", `${this.owner}:${query.branch}`);
    const items = await runJsonCommand<GitHubPullRequest[]>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/pulls?${params}`,
    ]);
    return {
      items: items
        .filter((pullRequest) =>
          !pullRequest.repository?.full_name
          || pullRequest.repository.full_name.toLowerCase() === `${this.owner}/${this.repository}`.toLowerCase())
        .map((pullRequest) => this.mapPullRequest(pullRequest)),
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

  async listPipelines(query: CollaborationQuery): Promise<CollaborationPage<Pipeline>> {
    const page = Math.max(1, Number(query.cursor ?? "1") || 1);
    const params = new URLSearchParams({
      per_page: "30",
      page: String(page),
    });
    if (query.branch) params.set("branch", query.branch);
    const response = await runJsonCommand<GitHubWorkflowRunsResponse>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/actions/runs?${params}`,
    ]);
    const items = response.workflow_runs ?? [];
    return {
      items: items
        .filter((run) => !query.search || (run.name ?? run.display_title ?? "").toLowerCase().includes(query.search.toLowerCase()))
        .map((run) => this.mapPipeline(run)),
      hasNextPage: items.length === 30,
      nextCursor: String(page + 1),
    };
  }

  async getPipeline(id: string): Promise<PipelineDetails> {
    const [run, jobsResponse] = await Promise.all([
      runJsonCommand<GitHubWorkflowRun>("gh", [
        "api",
        `repos/${this.owner}/${this.repository}/actions/runs/${id}`,
      ]),
      runJsonCommand<{ total_count: number; jobs: GitHubJob[] }>("gh", [
        "api",
        `repos/${this.owner}/${this.repository}/actions/runs/${id}/jobs?per_page=100`,
      ]),
    ]);
    const jobs = (jobsResponse.jobs ?? []).map((job) => this.mapPipelineJob(job));
    return {
      ...this.mapPipeline(run),
      stages: [],
      jobs,
      capabilities: {
        stages: false,
        jobs: true,
        logs: true,
        controls: this.getPipelineControls(run),
        limitations: ["GitHub Actions does not expose pipeline stages; jobs are shown directly."],
      },
    };
  }

  getPipelineLog(jobId: string): Promise<string> {
    return runTextCommand("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/actions/jobs/${jobId}/logs`,
    ]);
  }

  async runPipeline(id: string): Promise<void> {
    const run = await runJsonCommand<GitHubWorkflowRun>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/actions/runs/${id}`,
    ]);
    if (run.workflow_id === undefined) {
      throw new Error("GitHub did not provide a workflow for this run");
    }
    const args = [
      "workflow",
      "run",
      String(run.workflow_id),
      "--repo",
      `${this.owner}/${this.repository}`,
    ];
    if (run.head_branch) args.push("--ref", run.head_branch);
    await runCommand("gh", args);
  }

  async cancelPipeline(id: string): Promise<void> {
    await runCommand("gh", [
      "run",
      "cancel",
      id,
      "--repo",
      `${this.owner}/${this.repository}`,
    ]);
  }

  async retryPipeline(id: string): Promise<void> {
    await runCommand("gh", [
      "run",
      "rerun",
      id,
      "--failed",
      "--repo",
      `${this.owner}/${this.repository}`,
    ]);
  }

  async approvePipeline(id: string): Promise<void> {
    await runCommand("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/actions/runs/${id}/approve`,
      "--method",
      "POST",
    ]);
  }

  resumePipeline(_id: string): Promise<void> {
    return unsupported("Resuming GitHub Actions runs");
  }

  async listIssues(query: CollaborationQuery): Promise<CollaborationPage<Issue>> {
    const page = Math.max(1, Number(query.cursor ?? "1") || 1);
    const params = new URLSearchParams({ state: "all", per_page: "30", page: String(page) });
    const items = await runJsonCommand<GitHubIssue[]>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/issues?${params}`,
    ]);
    const issues = items
      .filter((issue) => !issue.pull_request)
      .filter((issue) => !query.search || issue.title.toLowerCase().includes(query.search.toLowerCase()));
    return {
      items: issues.map((issue) => this.mapIssue(issue)),
      hasNextPage: items.length === 30,
      nextCursor: String(page + 1),
    };
  }

  async getIssue(id: string): Promise<IssueDetails> {
    const issue = await runJsonCommand<GitHubIssue>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/issues/${id}`,
    ]);
    return this.mapIssueDetails(issue);
  }

  async listIssueIterations(): Promise<CollaborationPage<IssueIteration>> {
    return {
      items: [],
      hasNextPage: false,
    };
  }

  async getIssueChildren(_id: string): Promise<IssueChild[]> {
    return [];
  }

  async updateIssueStatus(id: string, status: IssueStatus): Promise<IssueDetails> {
    if (status !== "open" && status !== "closed") {
      throw new Error("GitHub issue status must be open or closed");
    }
    await runJsonCommand<GitHubIssue>("gh", [
      "api",
      `repos/${this.owner}/${this.repository}/issues/${id}`,
      "--method",
      "PATCH",
      "--field",
      `state=${status}`,
    ]);
    return this.getIssue(id);
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

  private mapPipeline(run: GitHubWorkflowRun): Pipeline {
    return {
      id: String(run.id),
      name: run.name ?? run.display_title ?? `Workflow run ${run.id}`,
      status: mapPipelineStatus(run.status, run.conclusion),
      branch: run.head_branch ?? undefined,
      commit: run.head_sha ?? undefined,
      definitionId: run.workflow_id === undefined ? undefined : String(run.workflow_id),
      startedAt: run.run_started_at ?? run.created_at ?? undefined,
      finishedAt: run.status === "completed" ? run.updated_at : undefined,
      url: run.html_url,
    };
  }

  private getPipelineControls(run: GitHubWorkflowRun): PipelineControlCapabilities {
    const active = run.status === "queued" || run.status === "in_progress" || run.status === "waiting";
    const retryable = run.status === "completed"
      && ["failure", "cancelled", "timed_out", "startup_failure", "action_required"].includes(
        run.conclusion ?? "",
      );
    return {
      run: run.workflow_id !== undefined,
      cancel: active,
      retry: retryable,
      approve: run.status === "waiting" || run.conclusion === "action_required",
      resume: false,
    };
  }

  private mapPipelineJob(job: GitHubJob): PipelineJob {
    return {
      id: String(job.id),
      name: job.name,
      status: mapPipelineStatus(job.status, job.conclusion),
      logAvailable: true,
      startedAt: job.started_at ?? undefined,
      finishedAt: job.completed_at ?? undefined,
      url: job.html_url,
    };
  }

  private mapIssue(issue: GitHubIssue): Issue {
    return {
      id: String(issue.number),
      number: issue.number,
      title: issue.title,
      description: issue.body ?? undefined,
      status: issue.state,
      author: issue.user.login,
      updatedAt: issue.updated_at,
      url: issue.html_url,
    };
  }

  private mapIssueDetails(issue: GitHubIssue): IssueDetails {
    return {
      ...this.mapIssue(issue),
      labels: (issue.labels ?? []).map((label) => label.name),
      assignees: (issue.assignees ?? []).map((assignee) => assignee.login),
      children: [],
      capabilities: {
        canChangeStatus: this.capabilities.issueMutations,
        iterations: this.capabilities.issueIterations,
        children: this.capabilities.issueChildren,
        limitations: [
          "GitHub Issues does not expose sprint iterations or parent/child work-item hierarchy.",
        ],
      },
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
  repository?: { name?: string };
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

type AzurePipelineRun = {
  id: number;
  name?: string;
  state?: string;
  status?: string;
  result?: string | null;
  sourceBranch?: string;
  sourceVersion?: string;
  createdDate?: string;
  queueTime?: string;
  startTime?: string;
  finishedDate?: string | null;
  finishTime?: string | null;
  url?: string;
  definition?: { id?: number; name?: string };
};

type AzureTimelineRecord = {
  id: string;
  name?: string;
  type?: string;
  state?: string;
  result?: string | null;
  startTime?: string;
  finishTime?: string;
  parentId?: string;
  log?: { id?: number };
  url?: string;
};

type AzureWorkItem = {
  id: number;
  fields?: Record<string, unknown>;
  relations?: AzureWorkItemRelation[];
  url?: string;
};

type AzureWorkItemRelation = {
  rel?: string;
  url?: string;
};

type AzureIteration = {
  id?: string;
  name?: string;
  path?: string;
  children?: AzureIteration[];
  attributes?: {
    startDate?: string;
    finishDate?: string;
  };
};

export class AzureProvider extends CliProvider {
  readonly id = "azure" as const;
  readonly capabilities: CollaborationProviderCapabilities = {
    pullRequests: true,
    pullRequestDiffs: true,
    pullRequestComments: true,
    pullRequestCommentStatus: true,
    pullRequestActions: true,
    pipelines: true,
    pipelineStages: true,
    pipelineJobs: true,
    pipelineLogs: true,
    pipelineControls: true,
    issues: true,
    issueMutations: true,
    issueIterations: true,
    issueChildren: true,
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
      ...(query.branch ? ["--source-branch", query.branch] : []),
      "--top",
      "30",
      "--skip",
      String((page - 1) * 30),
      "--output",
      "json",
    ]);
    return {
      items: items
        .filter((pullRequest) =>
          !pullRequest.repository?.name
          || pullRequest.repository.name.toLowerCase() === this.repository.toLowerCase())
        .map((pullRequest) => this.mapPullRequest(pullRequest)),
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

  async listPipelines(query: CollaborationQuery): Promise<CollaborationPage<Pipeline>> {
    const args = [
      "pipelines",
      "runs",
      "list",
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--top",
      "30",
      "--query-order",
      "QueueTimeDesc",
      "--output",
      "json",
    ];
    if (query.branch) args.splice(-2, 0, "--branch", query.branch);
    const runs = await runJsonCommand<AzurePipelineRun[]>("az", args);
    return {
      items: runs
        .filter((run) => !query.search || (run.name ?? run.definition?.name ?? "").toLowerCase().includes(query.search.toLowerCase()))
        .map((run) => this.mapPipeline(run)),
      hasNextPage: false,
    };
  }

  async listIssues(query: CollaborationQuery): Promise<CollaborationPage<Issue>> {
    const iterationClause = query.iterationPath
      ? ` AND [System.IterationPath] = '${query.iterationPath.replaceAll("'", "''")}'`
      : "";
    const args = [
      "boards",
      "query",
      "--wiql",
      `SELECT TOP 30 [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project${iterationClause} ORDER BY [System.ChangedDate] DESC`,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--output",
      "json",
    ];
    const items = await runJsonCommand<AzureWorkItem[]>("az", args);
    return {
      items: items
        .filter((item) => !query.search || this.mapIssue(item).title.toLowerCase().includes(query.search.toLowerCase()))
        .map((item) => this.mapIssue(item)),
      hasNextPage: false,
    };
  }

  async listIssueIterations(): Promise<CollaborationPage<IssueIteration>> {
    const response = await runJsonCommand<AzureIteration[] | { value?: AzureIteration[] | AzureIteration }>("az", [
      "boards",
      "iteration",
      "project",
      "list",
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--output",
      "json",
    ]);
    const topLevelIterations = Array.isArray(response)
      ? response
      : Array.isArray(response.value)
        ? response.value
        : response.value && typeof response.value === "object"
          ? [response.value]
          : "id" in response && "name" in response && "path" in response
            ? [response as AzureIteration]
        : undefined;
    if (!topLevelIterations) {
      throw new Error("Azure iteration list returned an unexpected response shape");
    }
    const flattenIterations = (items: AzureIteration[]): AzureIteration[] =>
      items.flatMap((iteration) => [iteration, ...flattenIterations(iteration.children ?? [])]);
    const iterations = flattenIterations(topLevelIterations);
    return {
      items: iterations
        .filter((iteration) => iteration.id && iteration.path && iteration.name)
        .map((iteration) => ({
          id: iteration.id as string,
          name: iteration.name as string,
          path: iteration.path as string,
          startDate: iteration.attributes?.startDate,
          finishDate: iteration.attributes?.finishDate,
        })),
      hasNextPage: false,
    };
  }

  async getIssue(id: string): Promise<IssueDetails> {
    const item = await runJsonCommand<AzureWorkItem>("az", [
      "boards",
      "work-item",
      "show",
      "--id",
      id,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--output",
      "json",
    ]);
    return this.mapIssueDetails(item);
  }

  async getIssueChildren(id: string): Promise<IssueChild[]> {
    const item = await runJsonCommand<AzureWorkItem>("az", [
      "boards",
      "work-item",
      "show",
      "--id",
      id,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--expand",
      "all",
      "--output",
      "json",
    ]);
    const childIds = (item.relations ?? [])
      .filter((relation) => relation.rel === "System.LinkTypes.Hierarchy-Forward")
      .map((relation) => relation.url?.match(/\/workItems\/(\d+)(?:\?.*)?$/i)?.[1])
      .filter((childId): childId is string => childId !== undefined);
    const children = await Promise.all(childIds.map((childId) => this.getIssue(childId)));
    return children.map((child) => ({
      id: child.id,
      number: child.number,
      title: child.title,
      status: child.status,
      url: child.url,
    }));
  }

  async updateIssueStatus(id: string, status: IssueStatus): Promise<IssueDetails> {
    const state = status === "open" ? "Active" : status === "closed" ? "Closed" : undefined;
    if (!state) throw new Error("Azure work item status must be open or closed");
    await runCommand("az", [
      "boards",
      "work-item",
      "update",
      "--id",
      id,
      "--state",
      state,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--output",
      "none",
    ]);
    return this.getIssue(id);
  }

  async getPipeline(id: string): Promise<PipelineDetails> {
    const run = await runJsonCommand<AzurePipelineRun>("az", [
      "pipelines",
      "runs",
      "show",
      "--id",
      id,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--output",
      "json",
    ]);
    const timeline = await runJsonCommand<{ records?: AzureTimelineRecord[] }>("az", [
      "devops",
      "invoke",
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--area",
      "build",
      "--resource",
      "timeline",
      "--route-parameters",
      `project=${this.project}`,
      `buildId=${id}`,
      "--api-version",
      "7.1",
      "--output",
      "json",
    ]);
    const records = timeline.records ?? [];
    const stageRecords = records.filter((record) => record.type?.toLowerCase() === "stage");
    const jobRecords = records.filter((record) => record.type?.toLowerCase() === "job");
    const jobs = jobRecords.map((record) => this.mapPipelineJob(record, id));
    const stages = stageRecords.map((record) => ({
      id: record.id,
      name: record.name ?? record.id,
      status: mapPipelineStatus(record.state, record.result),
      startedAt: record.startTime,
      finishedAt: record.finishTime,
      jobs: jobs.filter((job) => job.stageId === record.id),
    }));
    return {
      ...this.mapPipeline(run),
      stages,
      jobs,
      capabilities: {
        stages: stageRecords.length > 0,
        jobs: jobRecords.length > 0,
        logs: jobs.some((job) => job.logAvailable),
        controls: this.getPipelineControls(run),
        limitations: stageRecords.length === 0
          ? ["Azure DevOps did not return stage records for this run."]
          : [],
      },
    };
  }

  async getPipelineLog(jobId: string): Promise<string> {
    const separator = jobId.indexOf(":");
    if (separator < 1) throw new Error("Azure pipeline job does not have a valid run reference");
    const runId = jobId.slice(0, separator);
    const recordId = jobId.slice(separator + 1);
    const timeline = await runJsonCommand<{ records?: AzureTimelineRecord[] }>("az", [
      "devops",
      "invoke",
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--area",
      "build",
      "--resource",
      "timeline",
      "--route-parameters",
      `project=${this.project}`,
      `buildId=${runId}`,
      "--api-version",
      "7.1",
      "--output",
      "json",
    ]);
    const record = timeline.records?.find((candidate) => candidate.id === recordId);
    const logId = record?.log?.id;
    if (!logId) throw new Error("Azure DevOps did not provide a log for this job");
    return runTextCommand("az", [
      "devops",
      "invoke",
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--area",
      "build",
      "--resource",
      "logs",
      "--route-parameters",
      `project=${this.project}`,
      `buildId=${runId}`,
      `logId=${logId}`,
      "--api-version",
      "7.1",
      "--accept-media-type",
      "text/plain",
    ]);
  }

  async runPipeline(id: string): Promise<void> {
    const run = await runJsonCommand<AzurePipelineRun>("az", [
      "pipelines",
      "runs",
      "show",
      "--id",
      id,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--output",
      "json",
    ]);
    const definitionId = run.definition?.id;
    if (definitionId === undefined) {
      throw new Error("Azure DevOps did not provide a pipeline definition for this run");
    }
    const args = [
      "pipelines",
      "run",
      "--id",
      String(definitionId),
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
    ];
    if (run.sourceBranch) args.push("--branch", run.sourceBranch.replace(/^refs\/heads\//, ""));
    args.push("--output", "none");
    await runCommand("az", args);
  }

  async cancelPipeline(id: string): Promise<void> {
    await runCommand("az", [
      "pipelines",
      "runs",
      "cancel",
      "--id",
      id,
      "--organization",
      `https://dev.azure.com/${this.organization}`,
      "--project",
      this.project,
      "--output",
      "none",
    ]);
  }

  async retryPipeline(id: string): Promise<void> {
    const project = encodeURIComponent(this.project);
    await runCommand("az", [
      "rest",
      "--method",
      "post",
      "--url",
      `https://dev.azure.com/${this.organization}/${project}/_apis/build/builds/${id}/retry?api-version=7.1-preview.2`,
      "--output",
      "none",
    ]);
  }

  private mapPipeline(run: AzurePipelineRun): Pipeline {
    return {
      id: String(run.id),
      name: run.name ?? run.definition?.name ?? `Pipeline run ${run.id}`,
      status: mapPipelineStatus(run.state ?? run.status, run.result),
      branch: run.sourceBranch?.replace(/^refs\/heads\//, ""),
      commit: run.sourceVersion,
      definitionId: run.definition?.id === undefined ? undefined : String(run.definition.id),
      startedAt: run.startTime ?? run.createdDate ?? run.queueTime,
      finishedAt: run.finishTime ?? run.finishedDate ?? undefined,
      url: run.url ?? "",
    };
  }

  private mapIssue(item: AzureWorkItem): Issue {
    const fields = item.fields ?? {};
    const title = String(fields["System.Title"] ?? `Work item ${item.id}`);
    const state = String(fields["System.State"] ?? "").toLowerCase();
    return {
      id: String(item.id),
      number: item.id,
      title,
      description: typeof fields["System.Description"] === "string"
        ? fields["System.Description"]
        : undefined,
      status: ["new", "active", "in progress", "to do"].includes(state) ? "open"
        : ["closed", "done", "resolved", "removed"].includes(state) ? "closed"
          : "unknown",
      author: String(fields["System.CreatedBy"] ?? "Unknown"),
      updatedAt: String(fields["System.ChangedDate"] ?? ""),
      url: item.url ?? "",
    };
  }

  private mapIssueIteration(fields: Record<string, unknown>): IssueIteration | undefined {
    const path = typeof fields["System.IterationPath"] === "string"
      ? fields["System.IterationPath"]
      : undefined;
    if (!path) return undefined;
    return {
      id: path,
      name: path.split("\\").at(-1) ?? path,
      path,
    };
  }

  private mapIssueDetails(item: AzureWorkItem): IssueDetails {
    const fields = item.fields ?? {};
    const assignedTo = fields["System.AssignedTo"];
    return {
      ...this.mapIssue(item),
      labels: typeof fields["System.Tags"] === "string"
        ? fields["System.Tags"].split(";").map((tag) => tag.trim()).filter(Boolean)
        : [],
      assignees: assignedTo ? [String(assignedTo)] : [],
      iteration: this.mapIssueIteration(fields),
      children: [],
      capabilities: {
        canChangeStatus: this.capabilities.issueMutations,
        iterations: this.capabilities.issueIterations,
        children: this.capabilities.issueChildren,
        limitations: [],
      },
    };
  }

  private mapPipelineJob(record: AzureTimelineRecord, runId: string): PipelineJob {
    return {
      id: `${runId}:${record.id}`,
      name: record.name ?? record.id,
      status: mapPipelineStatus(record.state, record.result),
      logAvailable: record.log?.id !== undefined,
      startedAt: record.startTime,
      finishedAt: record.finishTime,
      stageId: record.parentId,
      url: record.url,
    };
  }

  private getPipelineControls(run: AzurePipelineRun): PipelineControlCapabilities {
    const active = run.state?.toLowerCase() !== "completed"
      && run.status?.toLowerCase() !== "completed"
      && !run.finishTime
      && !run.finishedDate;
    const retryable = !active
      && ["failed", "canceled", "cancelled", "partiallysucceeded"].includes(run.result?.toLowerCase() ?? "");
    return {
      run: run.definition?.id !== undefined,
      cancel: active,
      retry: retryable,
      approve: false,
      resume: false,
    };
  }
}

function mapPipelineStatus(state?: string, result?: string | null): PipelineStatus {
  const normalizedResult = result?.toLowerCase();
  if (normalizedResult === "succeeded" || normalizedResult === "success") return "succeeded";
  if (normalizedResult === "failed" || normalizedResult === "failure") return "failed";
  if (normalizedResult === "canceled" || normalizedResult === "cancelled") return "canceled";
  switch (state?.toLowerCase()) {
    case "queued":
      return "queued";
    case "inprogress":
    case "in_progress":
    case "running":
      return "running";
    case "cancelling":
      return "canceled";
    case "completed":
      return "unknown";
    default:
      return "unknown";
  }
}
