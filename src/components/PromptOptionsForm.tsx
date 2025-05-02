import { useState, useEffect, useRef } from "react";
import { Form, ActionPanel } from "@raycast/api";
import { generatePromptActions } from "./PromptActions";
import { getPropertyByPath } from "../utils/placeholderFormatter";
import { PromptProps } from "../managers/PromptManager";
import { ScriptInfo } from "../utils/scriptUtils";
import { SpecificReplacements } from "../utils/placeholderFormatter";

interface OptionsFormProps {
  prompt: PromptProps;
  optionKeys?: string[];
  baseReplacements: Omit<SpecificReplacements, "clipboard">;
  promptSpecificRootDir?: string;
  scripts: ScriptInfo[];
}

/**
 * Component that renders a form for prompts requiring user-configurable options (dropdowns, text inputs).
 *
 * @param props The component props.
 * @param props.prompt The prompt data, including defined options and text inputs.
 * @param props.optionKeys List of option property names, used for dynamic option generation (new)
 * @param props.baseReplacements Base replacements without clipboard.
 * @param props.promptSpecificRootDir Root directory for file placeholder resolution.
 * @param props.scripts List of available scripts for the action panel.
 */
export function PromptOptionsForm({
  prompt,
  optionKeys = [],
  baseReplacements,
  promptSpecificRootDir,
  scripts,
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

  // Initialize default values for options
  useEffect(() => {
    const initialOptions: { [key: string]: string } = {};

    // Handle options referenced by option:xxx
    optionKeys.forEach((key) => {
      const values = getPropertyByPath(prompt, key);
      if (Array.isArray(values) && values.length > 0) {
        // Select the first option by default
        initialOptions[key] = String(values[0]);
      }
    });

    // Handle the traditional options object
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
            )}
          </>
        </ActionPanel>
      }
    >
      {/* Dynamically generate dropdown menus from properties specified by optionKeys */}
      {optionKeys.map((key) => {
        const values = getPropertyByPath(prompt, key);
        if (!Array.isArray(values) || values.length === 0) {
          // Skip non-array or empty array
          return null;
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
              <Form.Dropdown.Item key={String(value)} value={String(value)} title={String(value)} />
            ))}
          </Form.Dropdown>
        );
      })}

      {/* Dropdown menus generated from the traditional options object */}
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

      {/* Text input fields */}
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
