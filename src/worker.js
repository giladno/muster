/* global importScripts, __fbBatchedBridge */
'use strict';
self.global = self;
self.nativeLoggingHook = (msg, level)=>{
    postMessage({console: msg, level, muster: true});
};

const handlers = {
    executeApplicationScript: msg=>{
        for (let key in msg.inject)
            self[key] = JSON.parse(msg.inject[key]);
        try {
            importScripts(msg.url);
        } catch(err) { return {error: err.message}; }
        return {};
    },
};

self.addEventListener('message', ({data})=>{
    const reply = result=>postMessage({replyID: data.id, ...result});
    let handler = handlers[data.method];
    if (handler)
    {
        let result = handler(data);
        if (result)
            reply(result);
        return;
    }
    let error, result = [[], [], [], 0];
    if (typeof __fbBatchedBridge=='object')
    {
        try {
            result = __fbBatchedBridge[data.method].apply(null, data.arguments);
        } catch(err) { error = err.message; }
    }
    else
        error = '__fbBatchedBridge is not defined';
    reply({result: JSON.stringify(result), error});
}, false);

