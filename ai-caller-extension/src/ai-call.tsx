import { LaunchProps } from "@raycast/api";
import { ResultView } from "./components/ResultView";

interface AICallArguments {
    promptContent: string;
    systemPrompt?: string;
    providerName?: string;
}

/**
 * Command entry point for the AI Caller extension.
 * Parses arguments from the deeplink and renders the ResultView.
 */
export default function AICallCommand(props: LaunchProps<{ arguments: AICallArguments }>) {
    // Destructure arguments from props. Input arguments are URI-decoded automatically by Raycast
    const { promptContent, systemPrompt, providerName } = props.arguments;

    // Pass the parsed arguments to the ResultView component
    return (
        <ResultView
            initialPromptContent={promptContent}   // Pass the received prompt content
            initialSystemPrompt={systemPrompt}     // Pass the received system prompt (optional)
            initialProviderName={providerName}   // Pass the received provider name (optional)
        />
    );
} 