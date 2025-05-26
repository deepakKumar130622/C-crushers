// --- Enhanced Tokenizer ---
function tokenize(input) {
    const tokenSpecs = [
    [/^\/\/.*/, null],                     // Single-line comments
    [/^\/\*[\s\S]*?\*\//, null],           // Multi-line comments
    [/^#include\s*<[^>]+>/, 'INCLUDE'],    // Include directives
    [/^#include\s*"[^"]+"/, 'INCLUDE'],    // Local includes
    [/^\b(int|float|double|char|void|bool|if|else|while|for|do|return|break|continue|cout|cin|endl|class|struct|public|private|protected|new|delete|true|false|auto|const|static|namespace|using|template|typename|vector|map|string|pair)\b/, 'KEYWORD'],
    [/^[a-zA-Z_]\w*/, 'IDENTIFIER'],
    [/^\d+\.?\d*([eE][+-]?\d+)?/, 'NUMBER'],
    [/^'([^'\\]|\\.)'/, 'CHAR'],
    [/^"([^"\\]|\\.)*"/, 'STRING'],
    [/^<<|^>>/, 'STREAM'],
    [/^\+\+|^--/, 'OPERATOR'],
    [/^==|^!=|^<=|^>=|^&&|^\|\||^->|^\./, 'OPERATOR'],
    [/^::/, 'SCOPE'],
    [/^</, 'DELIMITER'],                  // Correct order: comes before generic OPERATOR
    [/^>/, 'DELIMITER'],
    [/^[+\-*/=!%&|~^]/, 'OPERATOR'],      // Comes after
    [/^[\[\](){};,:]/, 'DELIMITER'],
    [/^\s+/, null]
];


    let tokens = [];
    let position = 0;
    input = input.replace(/\r\n/g, '\n').replace(/[\u200B-\u200D\uFEFF]/g, '');

    while (position < input.length) {
        let matched = false;
        const substring = input.slice(position);

        for (const [regex, type] of tokenSpecs) {
            const match = regex.exec(substring);
            if (match) {
                if (type !== null) {
                    tokens.push({ type, value: match[0] });
                }
                position += match[0].length;
                matched = true;
                break;
            }
        }

        if (!matched) {
            throw new Error(`Syntax error at position ${position}: '${input[position]}'`);
        }
    }

    return tokens;
}

// --- Enhanced Parser ---
function parseTokens(tokens) {
    let i = 0;
    //const ast = [];

    function current() {
        return tokens[i];
    }

    function next() {
        i++;
    }

    function peek() {
        return tokens[i + 1];
    }

    function expect(type, value = null) {
        const t = current();
        if (!t || t.type !== type || (value !== null && t.value !== value)) {
            throw new Error(`Expected ${type} '${value}', got '${t ? t.value : 'EOF'}'`);
        }
        next();
        return t;
    }

    const PRECEDENCE = {
        '=':0,
        '||': 1,
        '&&': 2,
        '|': 3,
        '^': 4,
        '&': 5,
        '==': 6, '!=': 6,
        '<': 7, '<=': 7, '>': 7, '>=': 7,
        '<<': 8, '>>': 8,
        '+': 9, '-': 9,
        '*': 10, '/': 10, '%': 10,
        '.': 11, '->': 11, '::': 11
    };
    function evaluateLiteralExpression(expr) {
    // Only allow digits, decimal points, parentheses, + - * / operators, and spaces
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
        throw new Error(`Cannot evaluate non-literal expression: ${expr}`);
    }

    // Use Function constructor to safely evaluate the arithmetic expression
    // This will throw if invalid syntax
    try {
        // Disallow double dots, consecutive operators, etc. could be added here for safety
        return Function(`"use strict"; return (${expr});`)();
    } catch {
        throw new Error(`Invalid expression for evaluation: ${expr}`);
    }
}


function parseExpression(minPrecedence = 1) {
    function parsePrimary() {
        const token = current();
        if (!token) throw new Error("Unexpected end of input in expression");

        // Handle prefix unary operators
        if (token.type === "OPERATOR" && (token.value === "++" || token.value === "--" ||
            token.value === "+" || token.value === "-" || token.value === "!" || token.value === "~")) {
            const op = token.value;
            next();
            const operand = parsePrimary();
            return `(${op}${operand})`;
        }

        if (token.type === 'NUMBER' || token.type === 'IDENTIFIER' || 
            token.type === 'STRING' || token.type === 'CHAR' ||
            (token.type === 'KEYWORD' && (token.value === 'true' || token.value === 'false' || token.value === 'endl'))) {
            let result = token.value;
            next();

            // Postfix: ++ or --
            if (current() && current().type === "OPERATOR" && (current().value === "++" || current().value === "--")) {
                const op = current().value;
                next();
                return `(${result}${op})`;
            }

            // Loop to handle chaining
            while (current()) {
                if (current().value === '(') {
                    next();
                    const args = [];
                    while (current() && current().value !== ')') {
                        args.push(parseExpression());
                        if (current().value === ',') next();
                    }
                    expect("DELIMITER", ")");
                    result = `${result}(${args.join(', ')})`;
                } else if (current().value === '.' || current().value === '->') {
                    const op = current().value;
                    next();
                    const member = expect("IDENTIFIER").value;
                    result = `${result}${op}${member}`;
                } else if (current().value === '[') {
                    next();
                    const index = parseExpression();
                    expect("DELIMITER", "]");
                    result = `${result}[${index}]`;
                } else {
                    break;
                }
            }

            return result;
        }

        if (token.value === '(') {
            next();
            const expr = parseExpression();
            expect("DELIMITER", ")");
            return `(${expr})`;
        }

        if (token.value === '[') {
            next();
            const expr = parseExpression();
            expect("DELIMITER", "]");
            return `[${expr}]`;
        }

        if (token.type === 'KEYWORD' && token.value === 'new') {
            next();
            const type = expect("IDENTIFIER").value;
            if (current().value === '[') {
                next();
                const size = parseExpression();
                expect("DELIMITER", "]");
                return `new ${type}[${size}]`;
            } else {
                return `new ${type}()`;
            }
        }

        throw new Error(`Unexpected token in expression: ${token.value}`);
    }

    let left = parsePrimary();

    while (
        current() &&
        (current().type === 'OPERATOR' || current().type === 'SCOPE') &&
        PRECEDENCE[current().value] >= minPrecedence
    ) {
        const op = current().value;
        const precedence = PRECEDENCE[op];
        next();
        const right = parseExpression(op === '=' ? precedence : precedence + 1);
        left = `(${left} ${op} ${right})`;
    }

    return left;
}



    function parseType() {
        let type = '';
        // Handle const, static modifiers
        while (current().type === 'KEYWORD' && (current().value === 'const' || current().value === 'static')) {
            type += current().value + ' ';
            next();
        }
        
        // Template types
       // Parse templated types like vector<int>, map<string, int>
            if (current().value === 'vector' || current().value === 'map' || current().value === 'pair') {
                let baseType = expect("KEYWORD").value;
                if (current() && current().value === "<") {
                    next(); // consume '<'
                    let templateArgs = [];
                    while (current() && current().value !== ">") {
                        templateArgs.push(parseType());
                        if (current().value === ",") next();
                    }
                    expect("DELIMITER", ">");
                    type += `${baseType}<${templateArgs.join(", ")}>`;
                } else {
                    type += baseType;
                }
                return type;
            }

        
        // Base type
        if (current().type === 'KEYWORD') {
            type += expect("KEYWORD").value;
            } else {
                const id = expect("IDENTIFIER").value;
                if (id === "std" && current() && current().value === "::") {
                    next(); // skip '::'
                    const sub = expect("IDENTIFIER").value;
                    type += `std::${sub}`;
                } else {
                    type += id;
                }
                }

        
        // Pointer/reference
        while (current().value === '*' || current().value === '&') {
            type += current().value;
            next();
        }
        
        return type;
    }

    function parseParameterList() {
        const params = [];
        expect("DELIMITER", "(");
        
        while (current() && current().value !== ')') {
            const type = parseType();
            const name = expect("IDENTIFIER").value;
            params.push({ type, name });
            
            if (current().value === ',') {
                next();
            }
        }
        
        expect("DELIMITER", ")");
        return params;
    }
function evaluateLiteral(expr) {
    expr = expr.trim();

    // String literal
    if (/^".*"$/.test(expr)) {
        return { type: "string", value: expr.slice(1, -1) };
    }

    // Number literal
    if (!isNaN(expr)) {
        const num = Number(expr);
        if (Number.isInteger(num)) {
            return { type: "int", value: num };
        } else {
            return { type: "float", value: num };
        }
    }

    // Arithmetic expression evaluation (safe)
    if (/^[0-9+\-*/().\s]+$/.test(expr)) {
        try {
            const val = Function(`"use strict";return (${expr});`)();
            if (typeof val === "number") {
                if (Number.isInteger(val)) return { type: "int", value: val };
                else return { type: "float", value: val };
            }
        } catch {
            // evaluation failed
        }
    }

    return null; // Could not evaluate as literal
}

    function validateDeclaration(varType, value) {
    if (value === null) return; // no initializer

    const evalResult = evaluateLiteral(value);

    if (evalResult) {
        // Type compatibility checks
        if (varType === "int" && evalResult.type !== "int") {
            throw new Error(`Type error: Cannot assign ${evalResult.type} value '${evalResult.value}' to int`);
        }
        if ((varType === "float" || varType === "double") &&
            !(evalResult.type === "int" || evalResult.type === "float")) {
            throw new Error(`Type error: Cannot assign ${evalResult.type} value '${evalResult.value}' to ${varType}`);
        }
        if ((varType === "string" || varType === "std::string") && evalResult.type !== "string") {
            throw new Error(`Type error: Cannot assign ${evalResult.type} value '${evalResult.value}' to string`);
        }
    } else {
        // If evaluation failed, check for string literals
        if (varType === "string" || varType === "std::string") {
            if (!/^".*"$/.test(value)) {
                throw new Error(`Type error: Cannot assign non-string value '${value}' to string`);
            }
        }
    }
}

function parseDeclaration() {
    const type = parseType();
    const name = expect("IDENTIFIER").value;

    // Function declaration
    if (current().value === '(') {
        const params = parseParameterList();

        // Function definition
        if (current().value === '{') {
            const body = parseBlock();
            return { type: "function", returnType: type, name, params, body };
        }
        // Function declaration only
        else {
            expect("DELIMITER", ";");
            return { type: "functionDecl", returnType: type, name, params };
        }
    }
    // Variable declaration
    else {
        let value = null;
        if (current().value === '=') {
            next();
            value = parseExpression();

            // Validate type compatibility
            validateDeclaration(type, value);
        }
        expect("DELIMITER", ";");
        return { type: "declaration", varType: type, name, value };
    }
}


    function parseBlock() {
        expect("DELIMITER", "{");
        const body = [];
        while (current() && current().value !== "}") {
            body.push(parseStatement());
        }
        expect("DELIMITER", "}");
        return { type: "block", body };
    }

    function parseStatement() {
        const t = current();
        if (!t) throw new Error("Unexpected EOF");

        if (t.value === "{") {
            return parseBlock();
        }

        if (t.type === "INCLUDE") {
            const include = expect("INCLUDE").value;
            return { type: "include", value: include };
        }

        if (t.type === "KEYWORD") {
            switch (t.value) {
                case "int":
                case "float":
                case "double":
                case "char":
                case "bool":
                case "void":
                case "const":
                case "static":
                case "auto":
                case "template":
                case "string":
                case "vector":
                    return parseDeclaration();

                case "cin": {
                    expect("KEYWORD", "cin");
                    const inputs = [];
                    while (current() && current().type === "STREAM" && current().value === ">>") {
                        expect("STREAM", ">>");
                        const v = parseExpression();
                        inputs.push(v);
                    }
                    expect("DELIMITER", ";");
                    return { type: "input", inputs };
                }

                case "cout": {
                expect("KEYWORD", "cout");
                const parts = [];
                while (current() && current().value !== ';') 
                {
                    if (current().type === "STREAM" && current().value === "<<") {
                        expect("STREAM", "<<");
                        let expr = parseExpression();
                        parts.push(expr);
                    } else if ((current().type === "KEYWORD" || current().type === "IDENTIFIER") && current().value === "endl") {
                        next();
                        parts.push('\n');  // Actual newline character
                    } else if (current().type === "IDENTIFIER" && current().value === "std" &&
                            peek() && peek().value === "::" &&
                            tokens[i + 2] && tokens[i + 2].value === "endl") {
                        next(); // std
                        next(); // ::
                        next(); // endl
                        parts.push('\n');
                    } else {
                        throw new Error(`Expected '<<' or 'endl' in cout, got '${current().value}'`);
                    }
                }
                expect("DELIMITER", ";");
                return { type: "print", parts };
                    }

                case "if": {
                    expect("KEYWORD", "if");
                    expect("DELIMITER", "(");
                    const condition = parseExpression();
                    expect("DELIMITER", ")");
                    const thenStmt = parseStatement();
                    let elseStmt = null;
                    if (current() && current().type === "KEYWORD" && current().value === "else") {
                        expect("KEYWORD", "else");
                        elseStmt = parseStatement();
                    }
                    return { type: "if", condition, thenStmt, elseStmt };
                }

                case "while": {
                    expect("KEYWORD", "while");
                    expect("DELIMITER", "(");
                    const condition = parseExpression();
                    expect("DELIMITER", ")");
                    const body = parseStatement();
                    return { type: "while", condition, body };
                }

                case "do": {
                    expect("KEYWORD", "do");
                    const body = parseStatement();
                    expect("KEYWORD", "while");
                    expect("DELIMITER", "(");
                    const condition = parseExpression();
                    expect("DELIMITER", ")");
                    expect("DELIMITER", ";");
                    return { type: "doWhile", condition, body };
                }

                case "for": {
                    expect("KEYWORD", "for");
                    expect("DELIMITER", "(");
                    let init = null;
                    if (current().value !== ";") {
                        init = parseStatement();
                    } else {
                        next(); // skip empty init
                    }
                    let condition = "true";
                    if (current().value !== ";") {
                        condition = parseExpression();
                    }
                    expect("DELIMITER", ";");
                    let update = null;
                    if (current().value !== ")") {
                        update = parseExpression();
                    }
                    expect("DELIMITER", ")");
                    const body = parseStatement();
                    return { type: "for", init, condition, update, body };
                }

                case "return": {
                    expect("KEYWORD", "return");
                    let value = null;
                    if (current().value !== ";") {
                        value = parseExpression();
                    }
                    expect("DELIMITER", ";");
                    return { type: "return", value };
                }

                case "break": {
                    expect("KEYWORD", "break");
                    expect("DELIMITER", ";");
                    return { type: "break" };
                }

                case "continue": {
                    expect("KEYWORD", "continue");
                    expect("DELIMITER", ";");
                    return { type: "continue" };
                }

                default:
                    throw new Error(`Unsupported keyword: ${t.value}`);
            }
        }

        // Try to parse as expression statement
        try {
            const expr = parseExpression();
            expect("DELIMITER", ";");
            return { type: "expression", expression: expr };
        } catch (e) {
            throw new Error(`Invalid statement: ${t.value}`);
        }
    }

      const ast = [];
 while (i < tokens.length) {
try {
            const node = parseStatement();
            if (node) {
                ast.push(node);
            }
        } catch (e) {
            console.error("Parsing error:", e);
            throw e;
        }
    }
    
    return ast;  // Return the array of nodes
}
function generateJS(ast, inputBuffer = [], isTopLevel = true) {
    if (!Array.isArray(ast)) {
        if (ast && typeof ast === 'object') {
            ast = [ast]; // Convert single node to array
        } else {
            throw new Error("AST must be an array or object");
        }
    }
    let code = '';
    let includes = [];
     
    // First pass for includes and function declarations
    for (const node of ast) {
        if (node.type === "include") {
            includes.push(node.value);
            // Add polyfills for STL includes
            if (node.value.includes('<vector>')) {
                code += `class Vector {
                    constructor() { this.data = []; this.size = 0; }
                    push_back(val) { this.data.push(val); this.size++; }
                    pop_back() { if (this.size > 0) { this.size--; return this.data.pop(); } }
                    at(index) { if (index < 0 || index >= this.size) throw 'Out of bounds'; return this.data[index]; }
                    size() { return this.size; }
                    empty() { return this.size === 0; }
                }\n`;
            }

            if (node.value.includes('<map>')) {
                code += `class Map {
                    constructor() { this.data = {}; }
                    insert(pair) { this.data[pair.key] = pair.value; }
                    find(key) { return this.data.hasOwnProperty(key) ? { second: this.data[key] } : { second: undefined }; }
                    size() { return Object.keys(this.data).length; }
                    empty() { return Object.keys(this.data).length === 0; }
                }\n`;
            }
            if (node.value.includes('<algorithm>')) {
                code += `const std = {
                    sort: (arr) => arr.sort((a, b) => a - b),
                    max: (a, b) => a > b ? a : b,
                    min: (a, b) => a < b ? a : b
                };\n`;
            }
        } else if (node.type === "functionDecl") {
            code += `function ${node.name}(${node.params.map(p => p.name).join(', ')}) { throw "${node.name} not implemented"; }\n`;
        }
    }
    
    if (isTopLevel) {
        code += "const __input = [...arguments[0]];\n";
        code += "function __inputProvider() { if (__input.length === 0) throw 'No more input'; return __input.shift(); }\n";
        code += "let __outputs = [];\n";
        
        // Check for main function
        const hasMain = ast.some(node => node.type === "function" && node.name === "main");
        if (!hasMain) {
            code += "function main() {\n";
        }
    }
    
    // Second pass for actual code generation
    for (const node of ast) {
        switch (node.type) {
            case "include":
                // Handled in first pass
                break;
                
            case "declaration":
                if (/^vector<.*>$/.test(node.varType) || node.varType === 'vector') {
                    code += `let ${node.name} = new Vector();\n`;
                } else if (/^map<.*>$/.test(node.varType) || node.varType === 'map') {
                    code += `let ${node.name} = new Map();\n`;
                } else {
                    let init = node.value !== null ? ` = ${node.value}` : '';
                    if ((node.varType === 'string' || node.varType === 'std::string') && node.value === null) {
                        init = ` = ""`;
                    }
                    code += `let ${node.name}${init};\n`;
                }
                break;
                
            case "function":
                code += `function ${node.name}(${node.params.map(p => p.name).join(', ')}) {\n`;
                code += generateJS(node.body, inputBuffer, false);
                code += `}\n`;
                break;
                
            case "input":
                for (const v of node.inputs) {
                    code += `${v} = Number(__inputProvider());\n`;
                }
                break;
                
            case "print":
                    if (node.parts.length === 0) {
                        code += `__outputs.push("");\n`;
                    } else {
                        // Replace 'endl' with newline string, wrap others with String()
                        const parts = node.parts.map(p => {
                            if (p === "endl") return `"\\n"`;         // C++-style endl
                            if (p === '\n') return `"\\n"`;            // internal mapping
                            return `String(${p})`;
                        });
                        code += `__outputs.push(${parts.join(' + ')});\n`;
                    }
                    break;


            case "if":
                code += `if (${node.condition}) {\n`;
                code += generateJS([node.thenStmt], inputBuffer, false);
                code += `}\n`;
                if (node.elseStmt) {
                    code += `else {\n`;
                    code += generateJS([node.elseStmt], inputBuffer, false);
                    code += `}\n`;
                }
                break;
                
            case "while":
                code += `while (${node.condition}) {\n`;
                code += generateJS([node.body], inputBuffer, false);
                code += `}\n`;
                break;
                
            case "doWhile":
                code += `do {\n`;
                code += generateJS([node.body], inputBuffer, false);
                code += `} while (${node.condition});\n`;
                break;
                
            case "for":
                code += `{\n`;
                if (node.init) {
                    code += generateJS([node.init], inputBuffer, false);
                }
                code += `while (${node.condition}) {\n`;
                code += generateJS([node.body], inputBuffer, false);
                if (node.update) {
                    code += `${node.update};\n`;
                }
                code += `}\n}\n`;
                break;
                
            case "return":
                if (node.value !== null) {
                    code += `return ${node.value};\n`;
                } else {
                    code += `return;\n`;
                }
                break;
                
            case "break":
                code += `break;\n`;
                break;
                
            case "continue":
                code += `continue;\n`;
                break;
                
            case "block":
                code += `{\n`;
                for (const stmt of node.body) {
                    code += generateJS([stmt], inputBuffer, false);
                }
                code += `}\n`;
                break;
                
            case "expression":
                code += `${node.expression};\n`;
                break;
        }
    }
    
    if (isTopLevel) {
        const hasMain = ast.some(node => node.type === "function" && node.name === "main");
        if (!hasMain) {
            code += "}\n";
            code += "main();\n";
        } else {
            code += "main();\n";
        }
        // Modified output joining - ensure proper newlines for endl
        code += "return __outputs.join('\\n');\n";
    }
    
    return code;
}

// --- Enhanced Run the JS ---
function runJS(jsCode, inputs) {
    try {
        const runner = new Function(jsCode);
        const result = runner(inputs);
        // Handle undefined output and ensure string return
        if (result === undefined) {
            return "Program executed successfully (no output)";
        }
        return String(result);
    } catch (e) {
        console.error("Runtime error:", e);
        return "Runtime error: " + e.message;
    }
}
window.compileAndRun = function() {
    try {
        const code = document.getElementById("code").value;
        const userInput = document.getElementById("userInput").value;
        const inputs = userInput.trim() === "" ? [] : userInput.trim().split(/\s+/);
        
        console.log("Compiling code..."); // Debug log
        const tokens = tokenize(code);
        console.log("Tokens:", tokens); // Debug log
        
        const ast = parseTokens(tokens);
        console.log("AST:", ast); // Debug log
        
        const jsCode = generateJS(ast, inputs);
        console.log("Generated JavaScript:", jsCode); // Debug log
        
        const output = runJS(jsCode, inputs);
        console.log("Execution output:", output); // Debug log
        
        // Display output
        const outputElement = document.getElementById("output");
        outputElement.textContent = output;
        outputElement.style.color = "black";
        
    } catch (e) {
        console.error("Compilation error:", e); // Debug log
        const outputElement = document.getElementById("output");
        outputElement.textContent = "Error: " + e.message;
        outputElement.style.color = "red";
    }
}
// Expose functions to global scope
window.compileAndRun = compileAndRun;
window.tokenize = tokenize;
window.parseTokens = parseTokens;
window.generateJS = generateJS;
window.runJS = runJS;