import { useState, useEffect, useRef } from "react";
import { Form, ActionPanel } from "@raycast/api";
import { generatePromptActions } from "./PromptActions";
import { placeholderFormatter } from "../utils/placeholderFormatter";
import { PromptProps } from "../managers/PromptManager";
import { getIndentedPromptTitles } from "../utils/promptFormattingUtils";
import { ScriptInfo } from "../utils/scriptUtils";
import { AIProvider } from "../services/types";

interface OptionsFormProps {
    prompt: PromptProps;
    getFormattedContent: () => string;
    scripts: ScriptInfo[];
    aiProviders: AIProvider[];
}

export function PromptOptionsForm({ prompt, getFormattedContent, scripts, aiProviders }: OptionsFormProps) {
    const [selectedOptions, setSelectedOptions] = useState<{ [key: string]: string }>({});
    const [selectedTextInputs, setSelectedTextInputs] = useState<{ [key: string]: string }>({});

    const isMountedRef = useRef(false);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, [prompt.title]);

    const formattedContent = () => {
        const content = placeholderFormatter(getFormattedContent() || "", {
            ...selectedOptions,
            ...selectedTextInputs,
            promptTitles: getIndentedPromptTitles(),
        });
        return content;
    };

    const handleDropdownChange = (key: string, newValue: string) => {
        setSelectedOptions({ ...selectedOptions, [key]: newValue });
    };

    const handleTextFieldChange = (key: string, newValue: string) => {
        setSelectedTextInputs({ ...selectedTextInputs, [key]: newValue });
    };

    return (
        <Form
            actions={
                <ActionPanel>
                    <>{generatePromptActions(formattedContent, prompt.actions, scripts, aiProviders)}</>
                </ActionPanel>
            }
        >
            {Object.entries(prompt.options || {}).map(([key, values]) => (
                <Form.Dropdown
                    key={key}
                    id={key}
                    title={key}
                    value={selectedOptions[key] || values[0]}
                    onChange={(newValue) => handleDropdownChange(key, newValue)}
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
                    onChange={(newValue) => handleTextFieldChange(key, newValue)}
                />
            ))}
        </Form>
    );
} 