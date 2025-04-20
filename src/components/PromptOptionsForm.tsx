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

/**
 * Component that renders a form for prompts requiring user-configurable options (dropdowns, text inputs).
 *
 * @param props The component props.
 * @param props.prompt The prompt data, including defined options and text inputs.
 * @param props.getFormattedContent Function to retrieve the base formatted content before applying form options.
 * @param props.scripts List of available scripts for the action panel.
 * @param props.aiProviders List of available AI providers for the action panel.
 */
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

    /**
     * Generates the final prompt content based on the base content and the user's selections
     * in the form (dropdowns and text fields).
     *
     * @returns The final formatted content string with form options applied.
     */
    const formattedContent = () => {
        const content = placeholderFormatter(getFormattedContent() || "", {
            ...selectedOptions,
            ...selectedTextInputs,
            promptTitles: getIndentedPromptTitles(),
        });
        return content;
    };

    /**
     * Handles changes to dropdown form elements.
     * Updates the state with the selected dropdown value.
     *
     * @param key The key (identifier) of the dropdown being changed.
     * @param newValue The newly selected value.
     */
    const handleDropdownChange = (key: string, newValue: string) => {
        setSelectedOptions({ ...selectedOptions, [key]: newValue });
    };

    /**
     * Handles changes to text field form elements.
     * Updates the state with the entered text value.
     *
     * @param key The key (identifier) of the text field being changed.
     * @param newValue The newly entered text.
     */
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