import {element, studyButton} from './dom';
import type {StudyText} from './locale';
/** Examples document parser syntax, independently of a host's generation template. */
export function studySyntaxHelp(w: StudyText, appendPrompt: (rules: string) => void): HTMLElement {
    const panel = element('details', 'mdx-study-syntax'); panel.append(element('summary', '', w('syntaxTitle')));
    const examples: Array<[string, string]> = [
        ['syntaxBasic', '--答案--'], ['syntaxId', '--[card-id] 答案--'],
        ['syntaxBreak', '--第一行¶第二行--'], ['syntaxAudio', '--word--^^audio:word^^'],
    ];
    const list = element('dl');
    for (const [key, example] of examples) {
        const description = element('dd'); description.append(element('code', '', example)); list.append(element('dt', '', w(key)), description);
    }
    const rules = [w('syntaxSingleLine'), w('syntaxDelimiters'), w('syntaxTable'), w('syntaxCode'), w('syntaxUnique'), w('syntaxSpeech')];
    const tips = element('ul'); rules.forEach(rule => tips.append(element('li', '', rule)));
    panel.append(list, tips, studyButton(w('syntaxToPrompt'), () => appendPrompt([
        ...examples.map(([key, example]) => `${w(key)}: ${example}`), ...rules,
    ].join('\n')), 'quiet'));
    return panel;
}
