import { getPreferenceValues } from "@raycast/api";
import { expandPath } from "../utils/path-alias-utils";

describe("expandPath", () => {
  const mockAliases = (aliases: Record<string, string>) =>
    (getPreferenceValues as jest.Mock).mockReturnValue({ pathAliases: JSON.stringify(aliases) });

  afterEach(() => {
    (getPreferenceValues as jest.Mock).mockReturnValue({});
  });

  it("returns paths unchanged when no alias matches", () => {
    mockAliases({});
    expect(expandPath("/tmp/project/readme.md")).toBe("/tmp/project/readme.md");
  });

  it("expands an alias and treats a following dot as a separator", () => {
    mockAliases({ job: "/Users/me/Documents/Career/" });
    expect(expandPath("job")).toBe("/Users/me/Documents/Career");
    expect(expandPath("job.plans")).toBe("/Users/me/Documents/Career/plans");
    expect(expandPath("job/plans/q1.md")).toBe("/Users/me/Documents/Career/plans/q1.md");
  });

  it("strips Finderlink prefixes and Markdown emphasis before expanding", () => {
    mockAliases({ job: "/Users/me/Documents/Career" });
    expect(expandPath("fk:job")).toBe("/Users/me/Documents/Career");
    expect(expandPath("📁 job.**plans**")).toBe("/Users/me/Documents/Career/plans");
  });

  it("prefers the longest alias", () => {
    mockAliases({ job: "/a", jobs: "/b" });
    expect(expandPath("jobs.x")).toBe("/b/x");
  });
});
