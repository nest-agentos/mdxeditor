import type {StudyCreation} from './contracts';
import type {StudyText} from './locale';
import {element, studyButton} from './dom';
import {randomUUID} from '../utils/random';
import {studyFailure} from './operations';
type SourceItem = Awaited<ReturnType<NonNullable<StudyCreation['sources']>['search']>>[number];
/** Source IDs and search scope belong entirely to the host. */
export class StudySourceSearch {
    readonly element = element('div', 'mdx-study-source-search');
    readonly button: HTMLButtonElement;
    private query = element('input');
    private results = element('div', 'mdx-study-source-search__results');
    private status = element('p', 'mdx-study__hint');
    private location = element('p', 'mdx-study__hint');
    private back: HTMLButtonElement;
    private stack: SourceItem[] = [];
    private items: SourceItem[] = [];
    private completedQuery?: string;
    private enterPending = false;
    private revision = 0;
    private pending?: AbortController;
    private timer?: ReturnType<typeof setTimeout>;
    constructor(private host: NonNullable<StudyCreation['sources']>, private signal: AbortSignal, private w: StudyText,
        private read: (content: () => Promise<string>) => void, target?: HTMLTextAreaElement) {
        this.element.hidden = true; this.query.type = 'search'; this.query.placeholder = w('searchSources'); this.query.setAttribute('aria-label', w('searchSources'));
        this.status.role = 'status'; this.back = studyButton(w('sourceBack'), () => {this.stack.pop(); this.query.value=''; void this.search();}, 'quiet');
        this.element.append(this.back, this.location, this.query, element('p','mdx-study__hint',w('sourceSearchHelp')), this.results, this.status);
        this.button = studyButton(w('chooseSource'), () => {this.element.hidden = false; this.query.focus(); void this.search();}, 'quiet');
        this.query.oninput = () => this.schedule(); this.query.onkeydown = event => this.key(event);
        target?.addEventListener('input', () => {
            const match = /(?:^|\s)@([^\n]*)$/.exec(target.value.slice(0, target.selectionStart));
            if (match) {this.element.hidden = false; this.query.value = match[1]; this.schedule();}
        }, {signal});
        signal.addEventListener('abort', () => {this.revision++; this.pending?.abort(); clearTimeout(this.timer);}, {once: true});
    }
    private schedule(): void {
        this.pending?.abort(); this.revision++; this.items=[]; this.enterPending=false; this.completedQuery=undefined; this.results.replaceChildren();
        this.status.textContent=this.w('working'); clearTimeout(this.timer); this.timer = setTimeout(() => {void this.search();}, 200);
    }
    private key(event: KeyboardEvent): void {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown') {event.preventDefault(); this.results.querySelector('button')?.focus();}
        if (event.key !== 'Enter') return; event.preventDefault(); event.stopPropagation();
        if (this.completedQuery === this.query.value && this.items.length) this.select(this.items[0]);
        else {clearTimeout(this.timer); this.enterPending=true; void this.search();}
    }
    private select(item: SourceItem): void {
        if (this.query.disabled) return;
        if (item.kind === 'directory') {this.stack.push(item); this.query.value=''; this.query.focus(); void this.search(); return;}
        this.read(async () => {const content=await this.host.read(item.id,this.signal); if (!this.signal.aborted) this.element.hidden=true; return content;});
    }
    private async search(): Promise<void> {
        if (this.signal.aborted) return; this.pending?.abort(); const controller = this.pending = new AbortController();
        const revision=++this.revision, operationId=randomUUID(), started=Date.now(); this.status.textContent=this.w('working'); this.items=[]; this.results.replaceChildren();
        const parent=this.stack.at(-1); this.back.hidden=!parent; this.location.textContent=parent?.label ?? this.w('sourceLocations');
        try {
            const query=this.query.value.replace(/^\s*@/, '').trim();
            const items=await (parent ? this.host.search(query,controller.signal,parent.id) : this.host.search(query,controller.signal));
            if (this.signal.aborted || revision!==this.revision) return;
            this.items=items; this.completedQuery=this.query.value;
            this.results.replaceChildren(...items.map(item => studyButton((item.kind==='directory'?this.w('sourceFolderPrefix'):'')+item.label,()=>this.select(item),'quiet')));
            this.status.textContent=items.length ? this.w('sourceResults').replace('{count}',String(items.length)) : this.w('noSourceMatches');
            console.debug('[StudySourceSearch]', {operationId,stage:'search',result:'success',count:items.length,durationMs:Date.now()-started});
            if (this.enterPending) {this.enterPending=false; if(items.length) this.select(items[0]);}
        } catch(error) {
            if (this.signal.aborted || revision!==this.revision) return;
            this.enterPending=false; const {code}=studyFailure(error); this.status.textContent=`${this.w('failed')} (${code})`;
            console.warn('[StudySourceSearch]',{operationId,stage:'search',result:'failure',code,durationMs:Date.now()-started});
        }
    }
}
