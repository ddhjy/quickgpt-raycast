import { buildClaudeNewChatUrl } from "../utils/claude-deeplink";

describe("buildClaudeNewChatUrl", () => {
  it("encodes the prompt into the q parameter", () => {
    expect(buildClaudeNewChatUrl("你好")).toBe("claude://claude.ai/new?q=%E4%BD%A0%E5%A5%BD");
  });

  it("escapes reserved characters and newlines", () => {
    const url = buildClaudeNewChatUrl("a&b=c #d\ne?f");
    expect(url).toBe("claude://claude.ai/new?q=a%26b%3Dc%20%23d%0Ae%3Ff");
    expect(decodeURIComponent(new URL(url).searchParams.get("q") ?? "")).toBe("a&b=c #d\ne?f");
  });
});
