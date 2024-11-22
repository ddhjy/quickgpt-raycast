import { Clipboard, closeMainWindow, open, showToast, Toast } from "@raycast/api";
import { recognizeText } from "./utils";

export default async function command() {
  await closeMainWindow();

  try {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "文本识别...",
    });

    const recognizedText = await recognizeText();

    await toast.hide();

    if (!recognizedText) {
      return await showToast({
        style: Toast.Style.Failure,
        title: "没有识别到文本",
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
    await showToast({
      style: Toast.Style.Success,
      title: "成功",
    });
  } catch (e) {
    console.error(e);
    await showToast({
      style: Toast.Style.Failure,
      title: "失败",
    });
  }
}
