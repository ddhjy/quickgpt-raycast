import { recognizeText as recognizeTextSwift } from "swift:../swift";
import { getUserSelectedLanguages, usePreferences } from "./hooks";

export const recognizeText = async (isFullScreen = false) => {
  const preference = usePreferences();

  try {
    const languages = await getUserSelectedLanguages();

    const recognizedText = await recognizeTextSwift(
      isFullScreen,
      preference.keepImage || false,
      preference.ocrMode === "fast",
      preference.languageCorrection || false,
      preference.ignoreLineBreaks || false,
      preference.customWordsList ? preference.customWordsList.split(",") : [],
      languages.map((lang) => lang.value),
    );

    return recognizedText;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to recognize text");
  }
};
