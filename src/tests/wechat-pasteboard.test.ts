import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const reader = readFileSync(path.join(__dirname, "../../assets/read-web-selection.jxa"), "utf8");
const urlType = "org.chromium.source-url";
const articleURL = "https://mp.weixin.qq.com/s/test";

// Exercise AppKit with a private pasteboard. The test never sends a Copy to an app.
function capture(copy: string, sourceIsFrontmost = false) {
  const fixture = `
    function run() {
      const board = $.NSPasteboard.pasteboardWithUniqueName;
      try {
        const original = $.NSMutableArray.alloc.init;
        const rich = $.NSPasteboardItem.alloc.init;
        rich.setStringForType($("old"), $.NSPasteboardTypeString);
        rich.setStringForType($("<b>old</b>"), $.NSPasteboardTypeHTML);
        rich.setStringForType($("${articleURL}"), $("${urlType}"));
        original.addObject(rich);
        const file = $.NSPasteboardItem.alloc.init;
        file.setStringForType($("file:///tmp/document"), $.NSPasteboardTypeFileURL);
        original.addObject(file);
        board.writeObjects(original);
        function write(text, origin, writer) {
          const item = $.NSPasteboardItem.alloc.init;
          item.setStringForType($(text), $.NSPasteboardTypeString);
          if (origin) item.setStringForType($(origin), $("${urlType}"));
          if (writer) item.setStringForType($(writer), $("org.nspasteboard.source"));
          board.clearContents;
          board.writeObjects($.NSArray.arrayWithObject(item));
        }
        const selection = readCopiedArticle(board, () => { ${copy}; return true; }, () => ${sourceIsFrontmost});
        const items = board.pasteboardItems;
        return JSON.stringify({
          selection,
          plain: ObjC.unwrap(board.stringForType($.NSPasteboardTypeString)),
          html: ObjC.unwrap(board.stringForType($.NSPasteboardTypeHTML)),
          file: Number(items.count) === 2 ? ObjC.unwrap(items.objectAtIndex(1).stringForType($.NSPasteboardTypeFileURL)) : null,
        });
      } finally { board.releaseGlobally; }
    }
  `;
  return JSON.parse(
    execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-"], { input: reader + fixture, encoding: "utf8" }),
  );
}

const mac = process.platform === "darwin" ? describe : describe.skip;
mac("WeChat article copy", () => {
  const original = { plain: "old", html: "<b>old</b>", file: "file:///tmp/document" };

  it("returns only the newly selected text and restores every original item", () => {
    expect(capture(`write("一段\\n二段", "${articleURL}")`)).toEqual({ selection: "一段\n二段", ...original });
  });

  it("ignores a previous article on the clipboard when Copy does nothing", () => {
    expect(capture("")).toEqual({ selection: "", ...original });
  });

  it("restores a copy from a non-article tab in the same reader", () => {
    expect(capture('write("other page", "https://mp.weixin.qq.com.example.org/")', true)).toEqual({
      selection: "",
      ...original,
    });
  });

  it("leaves a competing write alone", () => {
    expect(capture(`write("article", "${articleURL}"); write("newer copy")`)).toMatchObject({
      selection: "",
      plain: "newer copy",
    });
  });

  it("ignores a copy attributed to a different application", () => {
    expect(capture(`write("external", "${articleURL}", "com.example.editor")`, true)).toMatchObject({
      selection: "",
      plain: "external",
    });
  });
});
