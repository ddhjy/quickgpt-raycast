import { useState, useEffect, useCallback } from "react";
import inputHistoryStore from "../stores/input-history-store";

/**
 * Custom hook for managing input history navigation
 * Provides functionality to navigate through history with keyboard
 */
export function useInputHistory(initialValue: string = "") {
  const [currentInput, setCurrentInput] = useState(initialValue);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);
  const [temporaryInput, setTemporaryInput] = useState("");

  useEffect(() => {
    const loadedHistory = inputHistoryStore.getHistory();
    setHistory(loadedHistory);
  }, []);

  const navigateHistory = useCallback(
    (direction: "up" | "down") => {
      const historyLength = history.length;
      if (historyLength === 0) return;

      let newIndex = historyIndex;

      if (direction === "up") {
        // Save current input if we're at the beginning
        if (historyIndex === -1 && currentInput.trim()) {
          setTemporaryInput(currentInput);
        }

        if (historyIndex < historyLength - 1) {
          newIndex = historyIndex + 1;
        }
      } else {
        // Navigate down
        if (historyIndex > -1) {
          newIndex = historyIndex - 1;
        }
      }

      setHistoryIndex(newIndex);

      if (newIndex === -1) {
        // Restore temporary input or clear
        setCurrentInput(temporaryInput);
      } else if (newIndex < historyLength) {
        setCurrentInput(history[newIndex]);
      }
    },
    [history, historyIndex, currentInput, temporaryInput],
  );

  const resetHistory = useCallback(() => {
    setHistoryIndex(-1);
    setTemporaryInput("");
  }, []);

  const updateInput = useCallback((value: string) => {
    setCurrentInput(value);
    setHistoryIndex(-1);
    setTemporaryInput("");
  }, []);

  return {
    currentInput,
    setCurrentInput: updateInput,
    navigateHistory,
    resetHistory,
    addToHistory: (input: string) => {
      inputHistoryStore.addToHistory(input);
      const updatedHistory = inputHistoryStore.getHistory();
      setHistory(updatedHistory);
    },
  };
}
