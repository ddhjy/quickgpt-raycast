import { contentFormat, SpecificReplacements } from '../contentFormat';

describe('contentFormat', () => {
  it('{{input}} {{clipboard}}', () => {
    const text = 'Hello {{input}}, your clipboard says {{clipboard}}';
    const replacements: SpecificReplacements = {
      input: 'World',
      clipboard: 'Copy me',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Hello World, your clipboard says Copy me');
  });
  it('{{clipboard|input}} {{clipboard}}', () => {
    const text = 'Hello {{clipboard|input}}, your clipboard says {{clipboard}}';
    const replacements: SpecificReplacements = {
      input: 'World',
      clipboard: 'Copy me',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Hello Copy me, your clipboard says Copy me');
  });

  it('{{input|selection|clipboard}} {{clipboard}}', () => {
    const text = 'Content: {{input|selection|clipboard}}';
    const replacements: SpecificReplacements = {
      selection: 'Selected text',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Content: Selected text');
  });

  it('{{i}} {{s}} {{c}}', () => {
    const text = 'Input: {{i}}, Selection: {{s}}, Clipboard: {{c}}';
    const replacements: SpecificReplacements = {
      input: 'Input text',
      selection: 'Selected text',
      clipboard: 'Clipboard text',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Input: Input text, Selection: Selected text, Clipboard: Clipboard text');
  });

  it('{{i|s|c}}', () => {
    const text = 'Content: {{i|s|c}}';
    const replacements: SpecificReplacements = {
      input: 'Input text',
      selection: 'Selected text',
      clipboard: 'Clipboard text',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Content: Input text');

    const replacements2: SpecificReplacements = {
      selection: 'Selected text',
      clipboard: 'Clipboard text',
    };
    const result2 = contentFormat(text, replacements2);
    expect(result2).toBe('Content: Selected text');

    const replacements3: SpecificReplacements = {
      clipboard: 'Clipboard text',
    };
    const result3 = contentFormat(text, replacements3);
    expect(result3).toBe('Content: Clipboard text');
  });

  it('{{p:i|s|c}}', () => {
    const text = 'Content: {{p:i|s|c}}';
    const replacements: SpecificReplacements = {
      input: 'Input text',
      selection: 'Selected text',
      clipboard: 'Clipboard text',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Content: <输入文本>');

    const replacements2: SpecificReplacements = {
    };
    const result2 = contentFormat(text, replacements2);
    expect(result2).toBe('Content: {{p:i|s|c}}');
  });

  it('{{unknown}}', () => {
    const text = 'Hello {{unknown}}';
    const replacements: SpecificReplacements = {};
    const result = contentFormat(text, replacements);
    expect(result).toBe('Hello {{unknown}}');
  });

  it('{{empty}}', () => {
    const text = 'Content: {{input}}';
    const replacements: SpecificReplacements = {
      clipboard: 'Clipboard text',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Content: {{input}}');
  });

  it('{{currentApp}}', () => {
    const text = 'Current app: {{currentApp}}';
    const replacements: SpecificReplacements = {
      currentApp: 'VS Code',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Current app: VS Code');
  });


  it('{{p:currentApp}}', () => {
    const text = 'Current app: {{p:currentApp}}';
    const replacements: SpecificReplacements = {
      currentApp: 'VS Code',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Current app: <当前应用>');
  });

  it('{{p:browserContent}}', () => {
    const text = 'Browser content: {{p:browserContent}}';
    const replacements: SpecificReplacements = {
      browserContent: 'Browser content',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Browser content: <browserContent>');
  });

  it('{{p:input}}', () => {
    const text = 'Input: {{input}}, Prefixed: {{p:input}}';
    const replacements: SpecificReplacements = {
      input: 'Hello',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Input: Hello, Prefixed: <输入文本>');
  });

  it('{{empty}}', () => {
    const text = 'Content: {{input}}';
    const replacements: SpecificReplacements = {
      input: '',
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe('Content: {{input}}');
  });
});