export type CollaborationProviderId = "github" | "azure";

export type CollaborationPage<T> = {
  items: T[];
  hasNextPage: boolean;
  nextCursor?: string;
};

export type CollaborationStatus = "open" | "closed" | "merged" | "draft" | "unknown";

export type PullRequest = {
  id: string;
  number: number;
  title: string;
  description?: string;
  status: CollaborationStatus;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  updatedAt: string;
  url: string;
};

export type PullRequestCapabilities = {
  canComment: boolean;
  canChangeCommentStatus: boolean;
  canMerge: boolean;
  canAbandon: boolean;
};

export type PullRequestDetails = PullRequest & {
  createdAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  capabilities: PullRequestCapabilities;
};

export type DiffLine = {
  content: string;
  kind: "context" | "addition" | "deletion";
  oldLine?: number;
  newLine?: number;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
};

export type DiffFile = {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
};

export type PullRequestDiff = {
  files: DiffFile[];
  additions: number;
  deletions: number;
};

export type PipelineStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "unknown";

export type Pipeline = {
  id: string;
  name: string;
  status: PipelineStatus;
  branch?: string;
  commit?: string;
  startedAt?: string;
  finishedAt?: string;
  url: string;
};

export type PipelineJob = {
  id: string;
  name: string;
  status: PipelineStatus;
  logAvailable: boolean;
};

export type PipelineDetails = Pipeline & {
  jobs: PipelineJob[];
};

export type IssueStatus = "open" | "closed" | "unknown";

export type Issue = {
  id: string;
  number: number;
  title: string;
  description?: string;
  status: IssueStatus;
  author: string;
  updatedAt: string;
  url: string;
};

export type IssueDetails = Issue & {
  labels: string[];
  assignees: string[];
};

export type CollaborationQuery = {
  cursor?: string;
  search?: string;
  branch?: string;
};

export type CollaborationProviderCapabilities = {
  pullRequests: boolean;
  pullRequestDiffs: boolean;
  pullRequestComments: boolean;
  pipelines: boolean;
  pipelineLogs: boolean;
  pipelineControls: boolean;
  issues: boolean;
  issueMutations: boolean;
};

export interface CollaborationProvider {
  readonly id: CollaborationProviderId;
  readonly capabilities: CollaborationProviderCapabilities;

  listPullRequests(query: CollaborationQuery): Promise<CollaborationPage<PullRequest>>;
  getPullRequest(id: string): Promise<PullRequestDetails>;
  getPullRequestDiff(id: string): Promise<PullRequestDiff>;

  listPipelines(query: CollaborationQuery): Promise<CollaborationPage<Pipeline>>;
  getPipeline(id: string): Promise<PipelineDetails>;
  getPipelineLog(jobId: string): Promise<string>;

  listIssues(query: CollaborationQuery): Promise<CollaborationPage<Issue>>;
  getIssue(id: string): Promise<IssueDetails>;
}
