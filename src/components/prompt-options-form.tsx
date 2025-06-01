import { useState, useEffect, useRef } from "react";
import { Form, ActionPanel, useNavigation } from "@raycast/api";
import { generatePromptActions } from "./prompt-actions";
import { getPropertyByPath } from "../utils/placeholder-formatter";
import { PromptProps } from "../managers/prompt-manager";
import { ScriptInfo } from "../utils/script-utils";
import { SpecificReplacements } from "../utils/placeholder-formatter";

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
  const navigation = useNavigation();
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
      } else if (values && typeof values === "object" && Object.keys(values).length > 0) {
        const firstEntryValue = Object.values(values as Record<string, string>)[0];
        initialOptions[key] = String(firstEntryValue);
      }
    });

    // Handle the traditional options object
    if (prompt.options) {
      Object.entries(prompt.options).forEach(([key, values]) => {
        if (!initialOptions[key]) {
          if (Array.isArray(values) && values.length > 0) {
            initialOptions[key] = values[0];
          } else if (values && typeof values === "object" && Object.keys(values).length > 0) {
            const firstEntryValue = Object.values(values as Record<string, string>)[0];
            initialOptions[key] = String(firstEntryValue);
          }
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
              navigation,
              undefined,
              undefined,
            )}
          </>
        </ActionPanel>
      }
    >
      {/* Dynamically generate dropdown menus from properties specified by optionKeys */}
      {optionKeys.map((key) => {
        const values = getPropertyByPath(prompt, key);

        if (Array.isArray(values)) {
          return (
            <Form.Dropdown
              key={key}
              id={key}
              title={key}
              value={selectedOptions[key] || String(values[0])}
              onChange={(newValue) => handleDropdownChange(key, newValue)}
            >
              {values.map((v) => (
                <Form.Dropdown.Item key={String(v)} value={String(v)} title={String(v)} />
              ))}
            </Form.Dropdown>
          );
        } else if (values && typeof values === "object") {
          const entries = Object.entries(values as Record<string, string>);
          const defaultValue = selectedOptions[key] || entries[0]?.[1];
          return (
            <Form.Dropdown
              key={key}
              id={key}
              title={key}
              value={defaultValue}
              onChange={(newValue) => handleDropdownChange(key, newValue)}
            >
              {entries.map(([label, val]) => (
                <Form.Dropdown.Item key={val} value={val} title={label} />
              ))}
            </Form.Dropdown>
          );
        }

        return null;
      })}

      {/* Dropdown menus generated from the traditional options object */}
      {Object.entries(prompt.options || {}).map(([key, values]) => {
        if (Array.isArray(values)) {
          return (
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
          );
        } else {
          const dictEntries = Object.entries(values as Record<string, string>);
          const defaultValue = selectedOptions[key] || dictEntries[0]?.[1];
          return (
            <Form.Dropdown
              key={key}
              id={key}
              title={key}
              value={defaultValue}
              onChange={(newValue) => handleDropdownChange(key, newValue)}
            >
              {dictEntries.map(([label, val]) => (
                <Form.Dropdown.Item key={val} value={val} title={label} />
              ))}
            </Form.Dropdown>
          );
        }
      })}

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
