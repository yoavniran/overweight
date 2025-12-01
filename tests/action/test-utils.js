import { vi } from "vitest";

export const createNotFoundError = () => {
  const error = new Error("Not Found");
  error.status = 404;
  return error;
};

export const createEnoentError = () => {
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  return error;
};

export const createOctokitMock = () => {
  const issuesApi = {
    listComments: vi.fn().mockResolvedValue({ data: [] }),
    createComment: vi.fn().mockResolvedValue({}),
    updateComment: vi.fn().mockResolvedValue({}),
    addLabels: vi.fn().mockResolvedValue({})
  };
  const reposApi = {
    createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
    getContent: vi.fn().mockRejectedValue(createNotFoundError()),
    get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } })
  };
  const pullsApi = {
    create: vi.fn().mockResolvedValue({ data: { number: 15, html_url: "https://example.com/pr/15" } }),
    list: vi.fn().mockResolvedValue({ data: [] })
  };
  const gitApi = {
    getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "abc123" } } }),
    createRef: vi.fn().mockResolvedValue({})
  };

  return {
    rest: {
      issues: issuesApi,
      repos: reposApi,
      pulls: pullsApi,
      git: gitApi
    },
    issues: issuesApi,
    repos: reposApi,
    pulls: pullsApi,
    git: gitApi
  };
};

export const resetOctokitMocks = (octokitMock) => {
  Object.values(octokitMock.rest.issues).forEach((fn) => fn.mockReset?.());
  Object.values(octokitMock.rest.repos).forEach((fn) => fn.mockReset?.());
  Object.values(octokitMock.rest.pulls).forEach((fn) => fn.mockReset?.());
  Object.values(octokitMock.git).forEach((fn) => fn.mockReset?.());

  octokitMock.rest.issues.listComments.mockResolvedValue({ data: [] });
  octokitMock.rest.issues.createComment.mockResolvedValue({});
  octokitMock.rest.issues.updateComment.mockResolvedValue({});
  octokitMock.rest.issues.addLabels.mockResolvedValue({});

  octokitMock.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
  octokitMock.rest.repos.getContent.mockRejectedValue(createNotFoundError());
  octokitMock.rest.repos.get.mockResolvedValue({ data: { default_branch: "main" } });

  octokitMock.rest.pulls.create.mockResolvedValue({
    data: { number: 15, html_url: "https://example.com/pr/15" }
  });
  octokitMock.rest.pulls.list.mockResolvedValue({ data: [] });

  octokitMock.rest.git.getRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
  octokitMock.rest.git.createRef.mockResolvedValue({});
};

