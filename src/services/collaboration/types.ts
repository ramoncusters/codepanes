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
  canComplete: boolean;
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

export type PullRequestCommentStatus = "active" | "resolved" | "closed" | "unknown";
export type PullRequestCommentSide = "left" | "right";
export type PullRequestCommentKind = "file" | "line";

export type PullRequestComment = {
  id: string;
  kind: PullRequestCommentKind;
  body: string;
  author: string;
  createdAt: string;
  updatedAt?: string;
  status: PullRequestCommentStatus;
  filePath?: string;
  line?: number;
  side?: PullRequestCommentSide;
  url?: string;
  threadId?: string;
};

export type PullRequestCommentInput = {
  body: string;
  filePath: string;
  line?: number;
  side?: PullRequestCommentSide;
};

export type PullRequestAction = "merge" | "complete" | "abandon";

export type PipelineStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "unknown";

export type Pipeline = {
  id: string;
  name: string;
  status: PipelineStatus;
  branch?: string;
  commit?: string;
  definitionId?: string;
  startedAt?: string;
  finishedAt?: string;
  url: string;
};

export type PipelineJob = {
  id: string;
  name: string;
  status: PipelineStatus;
  logAvailable: boolean;
  startedAt?: string;
  finishedAt?: string;
  url?: string;
  stageId?: string;
};

export type PipelineStage = {
  id: string;
  name: string;
  status: PipelineStatus;
  jobs: PipelineJob[];
  startedAt?: string;
  finishedAt?: string;
};

export type PipelineAction = "run" | "cancel" | "retry" | "approve" | "resume";

export type PipelineControlCapabilities = {
  run: boolean;
  cancel: boolean;
  retry: boolean;
  approve: boolean;
  resume: boolean;
};

export type PipelineCapabilities = {
  stages: boolean;
  jobs: boolean;
  logs: boolean;
  controls: PipelineControlCapabilities;
  limitations: string[];
};

export type PipelineDetails = Pipeline & {
  stages: PipelineStage[];
  jobs: PipelineJob[];
  capabilities: PipelineCapabilities;
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
  capabilities: {
    canChangeStatus: boolean;
  };
};

export type IssueAction = "close" | "reopen";

export type CollaborationQuery = {
  cursor?: string;
  search?: string;
  branch?: string;
};

export type CollaborationProviderCapabilities = {
  pullRequests: boolean;
  pullRequestDiffs: boolean;
  pullRequestComments: boolean;
  pullRequestCommentStatus: boolean;
  pullRequestActions: boolean;
  pipelines: boolean;
  pipelineStages: boolean;
  pipelineJobs: boolean;
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
  listPullRequestComments(id: string): Promise<CollaborationPage<PullRequestComment>>;
  createPullRequestComment(id: string, comment: PullRequestCommentInput): Promise<PullRequestComment>;
  updatePullRequestCommentStatus(
    pullRequestId: string,
    commentId: string,
    status: PullRequestCommentStatus,
  ): Promise<PullRequestComment>;
  mergePullRequest(id: string): Promise<PullRequestDetails>;
  completePullRequest(id: string): Promise<PullRequestDetails>;
  abandonPullRequest(id: string): Promise<PullRequestDetails>;

  listPipelines(query: CollaborationQuery): Promise<CollaborationPage<Pipeline>>;
  getPipeline(id: string): Promise<PipelineDetails>;
  getPipelineLog(jobId: string): Promise<string>;
  runPipeline(id: string): Promise<void>;
  cancelPipeline(id: string): Promise<void>;
  retryPipeline(id: string): Promise<void>;
  approvePipeline(id: string): Promise<void>;
  resumePipeline(id: string): Promise<void>;

  listIssues(query: CollaborationQuery): Promise<CollaborationPage<Issue>>;
  getIssue(id: string): Promise<IssueDetails>;
  updateIssueStatus(id: string, status: IssueStatus): Promise<IssueDetails>;
}
