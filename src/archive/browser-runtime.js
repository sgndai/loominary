// Browser bridge for Archive Model export.
// This file exposes data/download helpers only. Platform UI remains owned by
// the original handlers so Archive integration cannot add rows to the panel.

(function attachArchiveRuntime(global) {
    'use strict';

    const Runtime = {
        version: 'archive-runtime/v4',

        async exportRecord(record, options = {}) {
            if (!record || typeof record !== 'object') {
                throw new TypeError('Archive record is required');
            }
            if (typeof global.LoominaryArchiveExport === 'function') {
                return global.LoominaryArchiveExport(record, options);
            }
            throw new Error('Archive export engine is not attached');
        },

        async createBundle(processedData, options = {}) {
            if (typeof global.LoominaryArchiveBundle !== 'function') {
                throw new Error('Archive bundle engine is not attached');
            }
            return global.LoominaryArchiveBundle(processedData, options);
        },

        async downloadBundle(processedData, options = {}) {
            const result = await Runtime.createBundle(processedData, options);
            const blob = new Blob([result.bytes], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = result.filename || 'conversation.zip';
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return result;
        },

        attach(exporter) {
            if (typeof exporter !== 'function') throw new TypeError('Exporter must be a function');
            global.LoominaryArchiveExport = exporter;
        },

        attachBundle(exporter) {
            if (typeof exporter !== 'function') throw new TypeError('Bundle exporter must be a function');
            global.LoominaryArchiveBundle = exporter;
        }
    };

    global.LoominaryArchiveRuntime = Runtime;
})(typeof unsafeWindow !== 'undefined'
    ? unsafeWindow
    : typeof window !== 'undefined'
        ? window
        : globalThis);
