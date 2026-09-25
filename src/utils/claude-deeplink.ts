/**
 * Builds a Claude Desktop deep link that opens a new chat with the
 * composer prefilled with the given text.
 */
export function buildClaudeNewChatUrl(text: string): string {
  return `claude://claude.ai/new?q=${encodeURIComponent(text)}`;
}
