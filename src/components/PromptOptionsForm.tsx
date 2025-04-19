import { useState } from "react";
import { Form, ActionPanel } from "@raycast/api";
import { generatePromptActions } from "./PromptActions";
import { placeholderFormatter } from "../utils/placeholderFormatter";
import { PromptProps } from "../managers/PromptManager";
import { getIndentedPromptTitles } from "../utils/promptFormattingUtils";

interface OptionsFormProps {
    prompt: PromptProps;
    getFormattedContent: () => string;
}

export function PromptOptionsForm({ prompt, getFormattedContent }: OptionsFormProps) {
    const [selectedOptions, setSelectedOptions] = useState<{ [key: string]: string }>({});
    const [selectedTextInputs, setSelectedTextInputs] = useState<{ [key: string]: string }>({});

    const formattedContent = () =>
        placeholderFormatter(getFormattedContent() || "", {
            ...selectedOptions,
            ...selectedTextInputs,
            promptTitles: getIndentedPromptTitles(),
        });

    return (
        <Form
            actions={
                <ActionPanel>
                    {generatePromptActions(formattedContent, prompt.actions)}
                </ActionPanel>
            }
        >
            {Object.entries(prompt.options || {}).map(([key, values]) => (
                <Form.Dropdown
                    key={key}
                    id={key}
                    title={key}
                    value={selectedOptions[key] || values[0]}
                    onChange={(newValue) => {
                        setSelectedOptions({ ...selectedOptions, [key]: newValue });
                    }}
                >
                    {values.map((value) => (
                        <Form.Dropdown.Item key={value} value={value} title={value} />
                    ))}
                </Form.Dropdown>
            ))}
            {Object.entries(prompt.textInputs || {}).map(([key, placeholder]) => (
                <Form.TextField
                    key={key}
                    id={key}
                    title={key}
                    placeholder={placeholder}
                    value={selectedTextInputs[key] || ""}
                    onChange={(newValue) => {
                        setSelectedTextInputs({ ...selectedTextInputs, [key]: newValue });
                    }}
                />
            ))}
        </Form>
    );
} 