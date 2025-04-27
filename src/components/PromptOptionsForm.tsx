import { useState, useEffect, useRef } from "react";
import { Form, ActionPanel, Clipboard } from "@raycast/api";
import { generatePromptActions } from "./PromptActions";
import { placeholderFormatter, getPropertyByPath } from "../utils/placeholderFormatter";
import { PromptProps } from "../managers/PromptManager";
import { getIndentedPromptTitles } from "../utils/promptFormattingUtils";
import { ScriptInfo } from "../utils/scriptUtils";
import { AIProvider } from "../services/types";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import { buildFormattedPromptContent } from "../utils/promptFormattingUtils";

interface OptionsFormProps {
    prompt: PromptProps;
    optionKeys?: string[];
    baseReplacements: Omit<SpecificReplacements, 'clipboard'>;
    promptSpecificRootDir?: string;
    scripts: ScriptInfo[];
    aiProviders: AIProvider[];
}

/**
 * Component that renders a form for prompts requiring user-configurable options (dropdowns, text inputs).
 *
 * @param props The component props.
 * @param props.prompt The prompt data, including defined options and text inputs.
 * @param props.optionKeys 选项属性名列表，用于动态生成选项（新增）
 * @param props.baseReplacements Base replacements without clipboard.
 * @param props.promptSpecificRootDir Root directory for file placeholder resolution.
 * @param props.scripts List of available scripts for the action panel.
 * @param props.aiProviders List of available AI providers for the action panel.
 */
export function PromptOptionsForm({
    prompt,
    optionKeys = [],
    baseReplacements,
    promptSpecificRootDir,
    scripts,
    aiProviders
}: OptionsFormProps) {
    const [selectedOptions, setSelectedOptions] = useState<{ [key: string]: string }>({});
    const [selectedTextInputs, setSelectedTextInputs] = useState<{ [key: string]: string }>({});

    const isMountedRef = useRef(false);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, [prompt.title]);

    // 初始化选项的默认值
    useEffect(() => {
        const initialOptions: { [key: string]: string } = {};

        // 处理 option:xxx 引用的属性选项
        optionKeys.forEach(key => {
            const values = getPropertyByPath(prompt, key);
            if (Array.isArray(values) && values.length > 0) {
                // 默认选中第一个选项
                initialOptions[key] = String(values[0]);
            }
        });

        // 处理传统 options 对象
        if (prompt.options) {
            Object.entries(prompt.options).forEach(([key, values]) => {
                if (values.length > 0 && !initialOptions[key]) {
                    initialOptions[key] = values[0];
                }
            });
        }

        if (Object.keys(initialOptions).length > 0) {
            setSelectedOptions(initialOptions);
        }
    }, [prompt, optionKeys]);

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
                    <>
                        {generatePromptActions(
                            prompt,
                            { ...baseReplacements, ...selectedOptions, ...selectedTextInputs },
                            promptSpecificRootDir,
                            prompt.actions,
                            scripts,
                            aiProviders
                        )}
                    </>
                </ActionPanel>
            }
        >
            {/* 动态生成来自 optionKeys 指定属性的下拉菜单 */}
            {optionKeys.map((key) => {
                const values = getPropertyByPath(prompt, key);
                if (!Array.isArray(values) || values.length === 0) {
                    return null; // 跳过非数组或空数组
                }

                return (
                    <Form.Dropdown
                        key={key}
                        id={key}
                        title={key}
                        value={selectedOptions[key] || String(values[0])}
                        onChange={(newValue) => handleDropdownChange(key, newValue)}
                    >
                        {values.map((value) => (
                            <Form.Dropdown.Item
                                key={String(value)}
                                value={String(value)}
                                title={String(value)}
                            />
                        ))}
                    </Form.Dropdown>
                );
            })}

            {/* 传统的 options 对象生成的下拉菜单 */}
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

            {/* 文本输入框 */}
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