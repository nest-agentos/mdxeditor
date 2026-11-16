/** This program executes only inside QuickJS, never with the browser's Function/eval. */
export const HTML_GUEST = String.raw`
(() => {
    const native = globalThis.__htmlBridge;
    delete globalThis.__htmlBridge;
    const cache = new Map(), ids = new WeakMap(), callbacks = new Map(), registrations = [];
    let nextCallback = 0;
    const deny = () => {send('deny', 0, '', []);};
    function send(op, id, name, args) {
        const result = JSON.parse(native(JSON.stringify([op, id, name, args])));
        if (result.error) throw new Error(result.error);
        return result.value;
    }
    function encode(value) {return ids.has(value) ? {node: ids.get(value)} : value;}
    function decode(value) {
        if (Array.isArray(value)) return value.map(decode);
        return value && typeof value === 'object' && typeof value.node === 'number' ? wrap(value.node) : value;
    }
    function propertyName(name) {return name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());}
    function style(id) {
        return new Proxy(Object.create(null), {
            get(_, name) {
                if (name === 'setProperty') return (key, value) => send('set', id, 'style:' + key, [String(value)]);
                if (name === 'getPropertyValue') return key => send('get', id, 'style:' + key, []);
                if (name === 'cssText') return send('call', id, 'getAttribute', ['style']) || '';
                return typeof name === 'string' ? send('get', id, 'style:' + propertyName(name), []) : undefined;
            },
            set(_, name, value) {
                if (name === 'cssText') send('call', id, 'setAttribute', ['style', String(value)]);
                else send('set', id, 'style:' + propertyName(String(name)), [String(value)]);
                return true;
            }
        });
    }
    function dataset(id) {
        return new Proxy(Object.create(null), {
            get: (_, name) => typeof name === 'string' ? send('call', id, 'getAttribute', ['data-' + propertyName(name)]) : undefined,
            set: (_, name, value) => {send('call', id, 'setAttribute', ['data-' + propertyName(String(name)), String(value)]); return true;}
        });
    }
    function register(id, type, callback) {
        if (typeof callback !== 'function') return;
        const key = ++nextCallback; callbacks.set(key, callback); registrations.push({id, type, key});
        if (id >= 0) send('listen', id, String(type), [key]);
        return key;
    }
    const methods = new Set('querySelector querySelectorAll getElementById createElement createTextNode appendChild append prepend replaceChildren insertBefore remove getAttribute setAttribute removeAttribute insertAdjacentHTML focus'.split(' '));
    const nodeProperties = {
        ownerDocument: () => wrap(0), style: id => style(id), dataset: id => dataset(id), readyState: () => 'complete',
        classList: id => Object.fromEntries(['add','remove','toggle','contains'].map(method => [method, (...args) => send('call', id, 'class:' + method, args)])),
        addEventListener: id => (type, callback) => register(id, type, callback),
        removeEventListener: id => (type, callback) => {for (const entry of registrations) if (entry.id === id && entry.type === type && callbacks.get(entry.key) === callback) callbacks.delete(entry.key);}
    };
    function nodeProperty(id, name) {
        if (name === 'then' || name === 'constructor' || typeof name === 'symbol') return undefined;
        if (Object.hasOwn(nodeProperties, name)) return nodeProperties[name](id);
        if (name.startsWith('on')) return callbacks.get(registrations.findLast(entry => entry.id === id && entry.type === name.slice(2))?.key);
        if (methods.has(name)) return (...args) => decode(send('call', id, name, args.map(encode)));
        return decode(send('get', id, name, []));
    }
    function wrap(id) {
        if (id === null || id === undefined) return null;
        if (cache.has(id)) return cache.get(id);
        const result = new Proxy(Object.create(null), {
            get: (_, name) => nodeProperty(id, name),
            set(_, name, value) {
                if (String(name).startsWith('on')) {register(id, String(name).slice(2), value); return true;}
                send('set', id, String(name), [value]); return true;
            }
        });
        cache.set(id, result); ids.set(result, id); return result;
    }
    function eventObject(value, current) {
        return {...value, target: wrap(value.target), currentTarget: wrap(current), defaultPrevented: false,
            preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.propagationStopped = true;},
            stopImmediatePropagation() {this.propagationStopped = true; this.immediateStopped = true;}};
    }
    globalThis.__htmlDispatch = (key, node, data) => {
        const event = eventObject(data, node), callback = callbacks.get(key);
        if (callback && callback.call(wrap(node), event) === false) event.preventDefault();
        return (event.defaultPrevented ? 1 : 0) | (event.propagationStopped ? 2 : 0) | (event.immediateStopped ? 4 : 0);
    };
    globalThis.__htmlHandlers = handlers => {
        for (const handler of handlers) register(handler.id, handler.event, new Function('event', handler.source));
    };
    globalThis.__htmlReady = body => {
        for (const entry of registrations.slice()) {
            if (entry.id === 0 && entry.type === 'DOMContentLoaded' || [-1, body].includes(entry.id) && entry.type === 'load')
                globalThis.__htmlDispatch(entry.key, Math.max(0, entry.id), {type: entry.type, target: Math.max(0, entry.id)});
        }
    };
    const timerCallbacks = new Map();
    globalThis.__htmlTimer = (id, time) => {const callback = timerCallbacks.get(id); if (callback) callback(time);};
    function timer(callback, delay, repeat, args) {
        if (typeof callback !== 'function') throw new Error('HTML_TIMER_CALLBACK_REQUIRED');
        const id = send('timer', 0, repeat ? 'interval' : 'timeout', [Number(delay) || 0]);
        timerCallbacks.set(id, () => {if (!repeat) timerCallbacks.delete(id); callback(...args);}); return id;
    }
    globalThis.setTimeout = (callback, delay, ...args) => timer(callback, delay, false, args);
    globalThis.setInterval = (callback, delay, ...args) => timer(callback, delay, true, args);
    globalThis.clearTimeout = globalThis.clearInterval = id => {timerCallbacks.delete(id); send('timer', 0, 'clear', [id]);};
    globalThis.requestAnimationFrame = callback => timer(() => callback(send('clock', 0, '', [])), 16, false, []);
    globalThis.cancelAnimationFrame = globalThis.clearTimeout;
    globalThis.document = wrap(0);
    globalThis.window = globalThis.self = globalThis;
    globalThis.addEventListener = (type, callback) => register(-1, type, callback);
    globalThis.removeEventListener = (type, callback) => {for (const entry of registrations) if (entry.id === -1 && entry.type === type && callbacks.get(entry.key) === callback) callbacks.delete(entry.key);};
    Object.defineProperty(globalThis, 'onload', {set(callback) {register(-1, 'load', callback);}});
    const location = Object.freeze({href: 'about:blank', assign: deny, replace: deny, reload: deny});
    for (const name of ['parent','top','opener','frames','localStorage','sessionStorage','indexedDB','caches'])
        Object.defineProperty(globalThis, name, {get: deny, configurable: false});
    Object.defineProperty(globalThis, 'location', {get: () => location, set: deny});
    globalThis.navigator = Object.freeze({sendBeacon: deny});
    for (const name of ['fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource','Worker','SharedWorker','RTCPeerConnection','webkitRTCPeerConnection','open','postMessage','importScripts'])
        Object.defineProperty(globalThis, name, {value: deny, writable: false, configurable: false});
    globalThis.performance = Object.freeze({now: () => send('clock', 0, '', [])});
    globalThis.console = Object.freeze({log() {}, info() {}, warn() {}, error() {}, debug() {}});
})();`;
