import { Clipboard, closeMainWindow, open, showToast, Toast } from "@raycast/api";
import { recognizeText } from "./utils";

export default async function command() {
  await closeMainWindow();

  try {
    const recognizedText = await recognizeText();

    if (!recognizedText) {
      return await showToast({
        style: Toast.Style.Failure,
        title: "No text detected",
      });
    }

    if (recognizedText === "Error: failed to capture image") {
      return await showToast({
        style: Toast.Style.Failure,
        title: "取消",
      });
    }

    await Clipboard.copy(recognizedText);
    await open("raycast://extensions/ddhjy2012/quickgpt/index");
  } catch (e) {
    console.error(e);
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed detecting text",
    });
  }
}
