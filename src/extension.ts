import { TextDocument, Position, CancellationToken, CompletionContext,
    Range, CompletionItem, ExtensionContext, TextEditor,
    TextEditorEdit, Uri, commands, languages, window, CompletionItemProvider, CompletionItemLabel, CompletionItemKind, CompletionList, workspace } from "vscode";
import * as Symbols from './symbols';

// TYPE ALIASES
type CodeMap = {[key:string]: string};
type AliasMap = {[key:string]: string};

// CONVENIENCE OBJECTS.
let SPACE_KEY: string = 'space';

/**
 * Activation function.
 * 
 * @param context 
 */
export function activate(context: ExtensionContext) {


    const ctl = new UnicodeMaths(Symbols.default);

    let config = workspace.getConfiguration('custom-unicode-math');

    ctl.map.load(config.get("bindings", {}));
    ctl.map.forward(config.get("aliases", {}));

    let provider = languages.registerCompletionItemProvider({ pattern: "*" }, ctl, "\\");
    
    context.subscriptions.push(provider);

    context.subscriptions.push(commands.registerCommand('custom-unicode-math.commit_tab', () => ctl.commit('tab')));
    context.subscriptions.push(commands.registerCommand('custom-unicode-math.commit_space', () => ctl.commit(SPACE_KEY)));
    context.subscriptions.push(commands.registerCommand('custom-unicode-math.symbols_html', () => {
        commands.executeCommand('vscode.open', Uri.parse('https://github.com/mvoidex/UnicodeMath/blob/master/table.md'));
    }));
}

export function deactivate() {
}

/**
 * Extension of Map, where the keys are the keywords and the values are the characters.
 */
class LookupMap extends Map<string, string> {

    public forward(alias: string|AliasMap, key?: string): this {
        if(typeof alias == "string") {
            if(!key) return this;
            const val = this.get(key);
            if(val) this.set(alias, val);
        } else {
            Object.entries(alias).forEach(([key, value]) => this.forward(key, value))
        }
        return this;
    }

    public *keys(prefix?: string) {
        if(!prefix) {
            yield* super.keys();
        } else {
            for(let key of super.keys()) {
                if(key.startsWith(prefix)) yield key;
            }
        }
    }

    public getLabel(key: string): CompletionItemLabel|undefined {
        const value = this.get(key);
        if(!value) return undefined;

        return {
            detail: ` ${key}`,
            label: value
        };
    }

    public *labels(prefix?: string) {
        for(let key of this.keys(prefix)) {
            yield this.getLabel(key) as CompletionItem;
        }
    }

    public getItem(key: string, range?: Range): CompletionItem|undefined {
        const label = this.getLabel(key);
        const value = this.get(key);
        if(!label || !value) return undefined;

        const res = new CompletionItem(label);
        res.kind = CompletionItemKind.Text;
        res.filterText = key;
        res.insertText = value;
        res.sortText = key;
        res.range = range;
        return res;
    }

    public *items(prefix?: string, range?: Range) {
        for(let key of this.keys(prefix)) {
            yield this.getItem(key, range) as CompletionItem;
        }
    }

    public createCompletionList(prefix?: string, range?: Range, isIncomplete?: boolean): CompletionList<CompletionItem> {
        let xs = Array.from(this.items(prefix, range));
        return new CompletionList(xs, isIncomplete);
    }
    
    public load(values: CodeMap): this {
        Object.entries(values).forEach(([key, value]) => this.set(key, value))
        return this;
    }
}



class UnicodeMaths implements CompletionItemProvider<CompletionItem> {
    readonly map: LookupMap;
    constructor(entries?: CodeMap) {
        this.map = new LookupMap(Object.entries(entries || Symbols.default));
    }

    public provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext) {
        // Position of the current word?
        const [target, word] = this.evalPosition(document, position);
        if (!target || !word) { return; }
        let res = this.map.createCompletionList(word, target);
        return res;
    }

    public commit(key: string) {
        if (!key || !window.activeTextEditor || !window.activeTextEditor.selection) { return; }

        const editor: TextEditor = <TextEditor> window.activeTextEditor;
        const dokey = () => {
            if (key === SPACE_KEY) {
                commands.executeCommand('type', { source: 'keyboard', text: ' ' });
            } else {
                commands.executeCommand(key);
            }
        };

        var c = false;
        editor.edit((editor: TextEditorEdit) => {
            if(!window.activeTextEditor) { return; }
            window.activeTextEditor.selections.map((v) => {
                const position = v.start;
                if(window.activeTextEditor) {
                    const [target, word] = this.evalPosition(window.activeTextEditor.document, position);
                    if (target && word) {
                        const changed = this.doWord(word);
                        if (changed) {
                            editor.delete(target);
                            editor.insert(target.start, changed);
                            c = true;
                        };
                    }
                }
            });
        });
        // always propegate the space key, or propegate tab
        // only if not used to insert a character
        if (!c || key === SPACE_KEY) { return dokey(); }
    }

    private evalPosition(document: TextDocument, position: Position): any[] {
        if (position.character === 0) { return [null, null]; }
        try {
            const [range, word] = this.getWordRangeAtPosition(document, position);
            return !word || !word.startsWith('\\') ? [null, null] : [range, word];
        } catch (e) {
            return [null, null];
        }
    }

    // this implementation has a loser meaning of word (anything starting with \)
    private getWordRangeAtPosition(document: TextDocument, position: Position): any[] {
        const linestart = new Position(position.line, 0);
        const lnrange = new Range(linestart, position);
        const line = document.getText(lnrange);
        const slash = line.lastIndexOf('\\');
        const word = line.substr(slash).trim();
        const start = new Position(position.line, slash);
        const end = start.translate(undefined, word.length);
        return [new Range(start, end), word];
    }

    private doWord(word: string): string | null {
        const startch = word.charAt(1);
        if (startch === '_') { return this.mapToSubSup(word, subs); }
        else if (startch === '^') { return this.mapToSubSup(word, sups); }
        // else if (word.startsWith('\\i:')) { return this.mapToBoldIt(word, false); }
        else if (word.startsWith('\\i:')) { return 'foo'; }
        else if (word.startsWith('\\b:')) { return this.mapToBoldIt(word, true); }
        else if (!word.startsWith('\\:') && word.startsWith('\\') && word.includes(':')) { return this.mapTo(word); }
        return this.map.get(word) || null;
    }

    private mapToSubSup(word: string, mapper: {[key: string]: string}): string | null {
        const target = word.substr(2);
        const newstr = target.split('').map((c: string) => mapper[c] || c).join('');
        return newstr === target ? null : newstr;
    }

    private mapToBoldIt(word: string, bold: boolean): string | null {
        const target = word.substr(3);
        const codeprfx = bold ? '\\mbf' : '\\mit';
        const newstr = target.split('').map((c: string) => this.map.get(codeprfx + c) || c).join('');
        return newstr === target ? null : newstr;
    }

    private mapTo(word: string): string | null {
        const modifier = word.split(':');
        if (modifier.length === 2) {
            const mod    = modifier[0];
            const newstr = modifier[1];
            const modstr = newstr.split('').map((c: string) => this.map.get(mod + c) || c).join('');
            return modstr === newstr ? null : modstr;
        }
        return null;
    }
}

// see: https://en.wikipedia.org/wiki/Unicode_subscripts_and_superscripts
const sups: {[key: string]: string} = {    "L": "ᴸ", "I": "ᴵ", "y": "ʸ", "9": "⁹", "0": "⁰", "δ": "ᵟ", "w": "ʷ", "4": "⁴", "l": "ˡ",
    "Z": "ᶻ", "P": "ᴾ", "b": "ᵇ", "7": "⁷", ")": "⁾", "h": "ʰ", "6": "⁶", "W": "ᵂ", "=": "⁼", "χ": "ᵡ", "m": "ᵐ", "-": "⁻",
    "r": "ʳ", "p": "ᵖ", "c": "ᶜ", "v": "ᵛ", "d": "ᵈ", "ϕ": "ᵠ", "θ": "ᶿ", "1": "¹", "T": "ᵀ", "o": "ᴼ", "K": "ᴷ", "e": "ᵉ",
    "G": "ᴳ", "t": "ᵗ", "8": "⁸", "β": "ᵝ", "V": "ⱽ", "M": "ᴹ", "s": "ˢ", "i": "ⁱ", "k": "ᵏ", "α": "ᵅ", "A": "ᴬ", "5": "⁵",
    "2": "²", "u": "ᶸ", "H": "ᴴ", "g": "ᵍ", "(": "⁽", "j": "ʲ", "f": "ᶠ", "D": "ᴰ", "γ": "ᵞ", "U": "ᵁ", "E": "ᴱ", "a": "ᵃ",
    "N": "ᴺ", "n": "ⁿ", "B": "ᴮ", "x": "ˣ", "3": "³", "R": "ᴿ", "+": "⁺", "J": "ᴶ"
};

const subs: {[key: string]: string} = { "1": "₁", ")": "₎", "m": "ₘ", "4": "₄", "j": "ⱼ", "7": "₇", "β": "ᵦ", "8": "₈",
    "2": "₂", "3": "₃", "s": "ₛ", "u": "ᵤ", "χ": "ᵪ", "5": "₅", "t": "ₜ", "h": "ₕ", "-": "₋", "ρ": "ᵨ", "+": "₊",
    "o": "ₒ", "v": "ᵥ", "r": "ᵣ", "6": "₆", "(": "₍", "k": "ₖ", "x": "ₓ", "9": "₉", "=": "₌", "e": "ₑ", "l": "ₗ",
    "i": "ᵢ", "ϕ": "ᵩ", "a": "ₐ", "p": "ₚ", "n": "ₙ", "0": "₀"
};
