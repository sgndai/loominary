// Browser bridge for Archive Model export.
// Keeps browser handlers independent from Archive Model implementation.

(function attachArchiveRuntime(global) {
    'use strict';

    const Runtime = {
        version: 'archive-runtime/v2',

        async exportRecord(record, options = {}) {
            if (!record || typeof record !== 'object') {
                throw new TypeError('Archive record is required');
            }

            if (typeof global.LoominaryArchiveExport === 'function') {
                return global.LoominaryArchiveExport(record, options);
            }

            throw new Error('Archive export engine is not attached');
        },

        async downloadBundle(processedData, options = {}) {
            if (typeof global.LoominaryArchiveBundle === 'function') {
                const result = await global.LoominaryArchiveBundle(processedData, options);
                const blob = new Blob([result.bytes], { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = result.filename || 'conversation.zip';
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return result;
            }
            throw new Error('Archive bundle engine is not attached');
        },

        attach(exporter) {
            if (typeof exporter !== 'function') {
                throw new TypeError('Exporter must be a function');
            }
            global.LoominaryArchiveExport = exporter;
        },

        attachBundle(exporter) {
            if (typeof exporter !== 'function') {
                throw new TypeError('Bundle exporter must be a function');
            }
            global.LoominaryArchiveBundle = exporter;
        }
    };

    global.LoominaryArchiveRuntime = Runtime;
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
