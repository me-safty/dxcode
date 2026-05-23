import { describe, expect, it } from "vitest";
import {
  findJiraEstimateField,
  readJiraAssigneeAccountId,
  readJiraEstimateValue,
  readJiraSubtaskCount,
  readJiraTimeTracking,
} from "./planning.ts";

describe("jira planning helpers", () => {
  it("prefers exact story point fields", () => {
    expect(
      findJiraEstimateField([
        { id: "customfield_10014", name: "Estimate", schema: { type: "number" } },
        { id: "customfield_10016", name: "Story Points", schema: { type: "number" } },
      ]),
    ).toEqual({ id: "customfield_10016", label: "Story Points" });
  });

  it("ignores non-numeric estimate-like fields", () => {
    expect(
      findJiraEstimateField([
        { id: "customfield_10014", name: "Estimate", schema: { type: "string" } },
      ]),
    ).toBeNull();
  });

  it("reads assignee ids, estimate values, and subtask counts from issues", () => {
    const issue = {
      id: "10001",
      key: "PROJ-1",
      self: "https://example.atlassian.net/rest/api/3/issue/10001",
      fields: {
        assignee: { accountId: "account-1", displayName: "Alex" },
        customfield_10016: 8,
        subtasks: [{ key: "PROJ-2" }, { key: "PROJ-3" }],
      },
    };

    expect(readJiraAssigneeAccountId(issue)).toBe("account-1");
    expect(readJiraEstimateValue(issue, { id: "customfield_10016", label: "Story Points" })).toBe(
      8,
    );
    expect(readJiraSubtaskCount(issue)).toBe(2);
  });

  it("reads Jira time tracking fields when they are present", () => {
    const issue = {
      id: "10001",
      key: "PROJ-1",
      self: "https://example.atlassian.net/rest/api/3/issue/10001",
      fields: {
        timeoriginalestimate: 14400,
        timeestimate: 10800,
        aggregatetimeoriginalestimate: 28800,
        aggregatetimeestimate: 21600,
      },
    };

    expect(readJiraTimeTracking(issue)).toEqual({
      originalEstimateSeconds: 14400,
      remainingEstimateSeconds: 10800,
      aggregateOriginalEstimateSeconds: 28800,
      aggregateRemainingEstimateSeconds: 21600,
    });
  });
});
