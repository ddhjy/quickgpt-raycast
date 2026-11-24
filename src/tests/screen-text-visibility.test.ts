import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const reader = readFileSync(path.join(__dirname, "../../assets/read-screen-text.jxa"), "utf8");
const mac = process.platform === "darwin" ? it : it.skip;

mac("excludes Raycast, other displays and covered windows, keeping the exposed strip of the rear window", () => {
  const fixture = `
    function run() {
      function win(pid, x, width) {
        return { kCGWindowOwnerPID: pid, kCGWindowLayer: 0, kCGWindowAlpha: 1,
          kCGWindowBounds: { X: x, Y: 0, Width: width, Height: 80 } };
      }
      const display = rect(0, 0, 120, 80);
      const windows = [win(1, 0, 120), win(2, -100, 100), win(3, 0, 70), win(4, 10, 30), win(5, 0, 120)];
      const result = visibleWindows(windows, display, new Set([1]), -10);
      const rear = result[1].visible;
      return JSON.stringify({
        pids: result.map((w) => w.info.kCGWindowOwnerPID),
        visible: fullyVisible(rect(71, 10, 40, 10), rear),
        hidden: clipped(rear, rect(10, 10, 40, 10)).length === 0,
        crossing: fullyVisible(rect(65, 10, 20, 10), rear),
      });
    }
  `;
  const output = execFileSync("/usr/bin/osascript", ["-l", "JavaScript", "-"], {
    input: reader + fixture,
    encoding: "utf8",
  });
  expect(JSON.parse(output)).toEqual({ pids: [3, 5], visible: true, hidden: true, crossing: false });
});
