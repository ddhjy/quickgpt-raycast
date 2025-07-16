# Design Document

## Overview

This feature implements a priority system that ensures Copy and Paste operations specified in hjson configuration files have absolute precedence over all other settings in the Raycast prompt management system. The design extends the existing prompt management architecture to support operation-level configuration overrides while maintaining backward compatibility.

## Architecture

The priority system will be implemented as a layered configuration resolver that processes hjson files to extract Copy/Paste operation definitions and applies them with highest priority during action generation.

### Core Components

1. **Operation Configuration Parser**: Extracts Copy/Paste operation definitions from hjson files
2. **Priority Resolver**: Manages the hierarchy of configuration sources and ensures hjson supremacy
3. **Action Override Manager**: Modifies the existing action generation system to apply hjson-defined operations
4. **Configuration Watcher**: Monitors hjson files for changes and reloads operation configurations

## Components and Interfaces

### 1. Operation Configuration Parser

```typescript
interface CopyPasteOperation {
  type: 'copy' | 'paste';
  action: string; // Custom action implementation
  priority: number; // For resolving conflicts within hjson files
  source: string; // Source hjson file path
}

interface OperationConfig {
  copy?: CopyPasteOperation;
  paste?: CopyPasteOperation;
}

class OperationConfigParser {
  parseHjsonFile(filePath: string): OperationConfig | null;
  extractOperations(hjsonContent: any): OperationConfig;
  validateOperationConfig(config: OperationConfig): boolean;
}
```

### 2. Priority Resolver

```typescript
class PriorityResolver {
  private hjsonOperations: Map<string, OperationConfig> = new Map();
  private defaultOperations: OperationConfig;
  
  resolveOperation(type: 'copy' | 'paste'): CopyPasteOperation | null;
  addHjsonOperations(filePath: string, operations: OperationConfig): void;
  removeHjsonOperations(filePath: string): void;
  getEffectiveOperations(): OperationConfig;
}
```

### 3. Action Override Manager

Extends the existing `generatePromptActions` function in `src/components/prompt-actions.tsx` to check for hjson-defined operations before applying default Copy/Paste actions.

```typescript
interface ActionOverride {
  name: string;
  customImplementation: () => Promise<void>;
  shouldOverride: boolean;
}

class ActionOverrideManager {
  getOverrideForAction(actionName: string): ActionOverride | null;
  applyHjsonOperations(baseActions: ActionItem[]): ActionItem[];
}
```

### 4. Configuration Watcher

```typescript
class ConfigurationWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  
  watchHjsonFile(filePath: string, callback: (config: OperationConfig) => void): void;
  unwatchHjsonFile(filePath: string): void;
  reloadAllConfigurations(): void;
}
```

## Data Models

### Hjson Operation Definition Format

Operations will be defined in hjson files using the following structure:

```hjson
{
  // Existing prompt definitions...
  
  // New operation overrides section
  operations: {
    copy: {
      type: "copy"
      action: "custom-copy-implementation"
      priority: 100
    }
    paste: {
      type: "paste" 
      action: "custom-paste-implementation"
      priority: 100
    }
  }
}
```

### Priority Resolution Rules

1. **Hjson operations**: Highest priority (1000+)
2. **Prompt-specific actions**: Medium priority (500-999)
3. **Global preferences**: Low priority (100-499)
4. **Default system actions**: Lowest priority (1-99)

## Error Handling

### Configuration Parsing Errors

- **Malformed hjson**: Log error, skip file, continue with other sources
- **Invalid operation definition**: Log warning, use default operation
- **Missing required fields**: Provide clear error message with field name

### Runtime Errors

- **Custom action execution failure**: Fall back to default operation, log error
- **File system errors**: Graceful degradation, maintain existing functionality
- **Priority conflicts**: Use highest priority value, log resolution decision

### Error Recovery

```typescript
class ErrorHandler {
  handleParsingError(filePath: string, error: Error): void;
  handleRuntimeError(operation: string, error: Error): void;
  logPriorityResolution(conflicts: PriorityConflict[]): void;
}
```

## Testing Strategy

### Unit Tests

1. **Operation Configuration Parser**
   - Valid hjson parsing
   - Invalid hjson handling
   - Operation extraction accuracy
   - Validation logic

2. **Priority Resolver**
   - Correct priority ordering
   - Conflict resolution
   - Multiple file handling
   - Edge cases (empty files, missing operations)

3. **Action Override Manager**
   - Override application
   - Fallback behavior
   - Integration with existing actions

### Integration Tests

1. **End-to-End Operation Flow**
   - Hjson file loading → Priority resolution → Action execution
   - File modification → Configuration reload → Updated behavior
   - Multiple hjson files → Correct priority application

2. **Backward Compatibility**
   - Existing functionality unchanged when no hjson operations defined
   - Graceful handling of legacy configurations
   - No breaking changes to existing API

### Performance Tests

1. **Configuration Loading Performance**
   - Large hjson file parsing
   - Multiple file scanning
   - Memory usage optimization

2. **Runtime Performance**
   - Action generation speed
   - Priority resolution efficiency
   - File watching overhead

## Implementation Phases

### Phase 1: Core Infrastructure
- Implement OperationConfigParser
- Create basic PriorityResolver
- Add hjson operation schema validation

### Phase 2: Integration
- Extend prompt-actions.tsx with override capability
- Integrate with existing PromptManager
- Implement configuration watching

### Phase 3: Enhancement
- Add comprehensive error handling
- Implement logging and debugging features
- Performance optimization

### Phase 4: Testing & Documentation
- Complete test suite implementation
- User documentation
- Migration guide for existing configurations